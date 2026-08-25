import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { BIOME_DEFINITIONS } from "../src/config/game.js";
import { loadBundledCatalog } from "../src/content/bundled.js";
import { createBiomeField } from "../src/generation/biome-field.js";
import { generateMediumMap } from "../src/generation/medium.js";
import {
  cellsForWord,
  coordinateKey,
  type BiomeSite,
  type Bounds,
  type DailyMap,
  type PlacedWord,
  type WorldChunk,
} from "../src/generation/types.js";
import {
  generateDailyWorld,
  type WorldGenerationSnapshot,
} from "../src/generation/world.js";

const WIDTH = 1_200;
const HEIGHT = 675;
const MAP_VIEWPORT = { x: 42, y: 86, width: 1_116, height: 522 };
const DATE = "2026-08-26";
const SEED = "cruzaverso:readme:v0.1.0";

interface Point {
  x: number;
  y: number;
}

interface Frame {
  snapshot: WorldGenerationSnapshot;
  title: string;
  section?: DailyMap;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function fitBounds(bounds: Bounds): Bounds {
  const padded = {
    minX: bounds.minX - 8,
    minY: bounds.minY - 8,
    maxX: bounds.maxX + 8,
    maxY: bounds.maxY + 8,
  };
  const currentWidth = padded.maxX - padded.minX;
  const currentHeight = padded.maxY - padded.minY;
  const targetRatio = MAP_VIEWPORT.width / MAP_VIEWPORT.height;
  if (currentWidth / currentHeight < targetRatio) {
    const extra = (currentHeight * targetRatio - currentWidth) / 2;
    padded.minX -= extra;
    padded.maxX += extra;
  } else {
    const extra = (currentWidth / targetRatio - currentHeight) / 2;
    padded.minY -= extra;
    padded.maxY += extra;
  }
  return padded;
}

function project(bounds: Bounds, point: Point): Point {
  return {
    x:
      MAP_VIEWPORT.x +
      ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * MAP_VIEWPORT.width,
    y:
      MAP_VIEWPORT.y +
      ((point.y - bounds.minY) / (bounds.maxY - bounds.minY)) * MAP_VIEWPORT.height,
  };
}

function biomeLayer(snapshot: WorldGenerationSnapshot, bounds: Bounds): string {
  const field = createBiomeField(snapshot.biomeField, snapshot.biomeSites);
  const columns = 96;
  const rows = 46;
  const cellWidth = MAP_VIEWPORT.width / columns;
  const cellHeight = MAP_VIEWPORT.height / rows;
  const regions: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const worldX = bounds.minX + ((column + 0.5) / columns) * (bounds.maxX - bounds.minX);
      const worldY = bounds.minY + ((row + 0.5) / rows) * (bounds.maxY - bounds.minY);
      const biome = field.biomeAt(worldX, worldY);
      regions.push(
        `<rect x="${(MAP_VIEWPORT.x + column * cellWidth).toFixed(2)}" y="${(MAP_VIEWPORT.y + row * cellHeight).toFixed(2)}" width="${(cellWidth + 0.4).toFixed(2)}" height="${(cellHeight + 0.4).toFixed(2)}" fill="${BIOME_DEFINITIONS[biome].color}"/>`,
      );
    }
  }
  return `<g opacity=".62">${regions.join("")}</g>`;
}

function siteLayer(sites: readonly BiomeSite[], bounds: Bounds): string {
  return sites
    .map((site) => {
      const point = project(bounds, site);
      const definition = BIOME_DEFINITIONS[site.biome];
      return `<g transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})">
        <circle r="15" fill="#f5ead2" fill-opacity=".76" stroke="${definition.color}" stroke-width="2"/>
        <text text-anchor="middle" dominant-baseline="central" font-size="16" fill="#253a33">${definition.symbol}</text>
      </g>`;
    })
    .join("");
}

function chunkLayer(chunks: readonly WorldChunk[], bounds: Bounds): string {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const edges: string[] = [];
  for (const chunk of chunks) {
    for (const neighborId of chunk.neighbors) {
      if (chunk.id.localeCompare(neighborId) >= 0) continue;
      const neighbor = byId.get(neighborId);
      if (!neighbor) continue;
      const from = project(bounds, chunk);
      const to = project(bounds, neighbor);
      edges.push(
        `<path d="M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}"/>`,
      );
    }
  }
  const nodes = chunks
    .map((chunk) => {
      const point = project(bounds, chunk);
      return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4.5"/>`;
    })
    .join("");
  return `<g fill="#f5ead2" stroke="#294038" stroke-width="2" stroke-dasharray="5 5" opacity=".84">${edges}${nodes}</g>`;
}

function wordLayer(
  words: readonly PlacedWord[],
  bounds: Bounds,
  opacity: number,
  highlighted: boolean,
): string {
  const occupied = new Map<string, { point: Point; biome: PlacedWord["biome"]; crossing: boolean }>();
  for (const word of words) {
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      const existing = occupied.get(key);
      occupied.set(key, { point: cell, biome: word.biome, crossing: Boolean(existing) });
    }
  }
  const scale = MAP_VIEWPORT.width / (bounds.maxX - bounds.minX);
  const size = Math.max(5, Math.min(13, scale * 0.76));
  const cells = [...occupied.values()].map(({ point, biome, crossing }) => {
    const screen = project(bounds, point);
    const fill = highlighted ? "#f7edcf" : BIOME_DEFINITIONS[biome].color;
    const stroke = highlighted ? "#74511f" : "#293e36";
    return `<rect x="${(screen.x - size / 2).toFixed(2)}" y="${(screen.y - size / 2).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="1.4" fill="${fill}" stroke="${stroke}" stroke-width="${crossing ? 1.8 : 1.05}"/>`;
  });
  return `<g opacity="${opacity}">${cells.join("")}</g>`;
}

function framePresentation(frame: Frame, bounds: Bounds): { details: string; overlays: string } {
  const { snapshot, section } = frame;
  if (section) {
    return {
      details: `${section.words.length} rotas · ${section.report.crossings} cruzamentos · ${section.report.cycles} ciclos`,
      overlays: `${chunkLayer(snapshot.chunks, bounds)}${wordLayer(snapshot.words, bounds, 0.18, false)}${wordLayer(section.words, bounds, 1, true)}`,
    };
  }

  switch (snapshot.phase) {
    case "biome-field":
      return {
        details: `${snapshot.biomeSites.length} núcleos · 6 biomas`,
        overlays: siteLayer(snapshot.biomeSites, bounds),
      };
    case "chunks":
      return {
        details: `${snapshot.chunks.length} chunks conectados`,
        overlays: chunkLayer(snapshot.chunks, bounds),
      };
    case "word-placed":
    case "attempt-complete":
    case "selected":
      return {
        details: `${snapshot.words.length} rotas no mundo`,
        overlays: `${chunkLayer(snapshot.chunks, bounds)}${wordLayer(snapshot.words, bounds, 1, true)}`,
      };
  }
}

function render(frame: Frame, bounds: Bounds): string {
  const { snapshot } = frame;
  const { details, overlays } = framePresentation(frame, bounds);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ead8ad"/><stop offset=".5" stop-color="#d4bd87"/><stop offset="1" stop-color="#b99b62"/>
      </linearGradient>
      <pattern id="grain" width="31" height="29" patternUnits="userSpaceOnUse">
        <path d="M2 9Q11 4 19 10T31 8M0 23Q9 18 18 24T31 21" fill="none" stroke="#6d532c" stroke-opacity=".09" stroke-width=".8"/>
      </pattern>
      <filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#1b2924" flood-opacity=".35"/></filter>
      <clipPath id="map"><rect x="${MAP_VIEWPORT.x}" y="${MAP_VIEWPORT.y}" width="${MAP_VIEWPORT.width}" height="${MAP_VIEWPORT.height}" rx="9"/></clipPath>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#20342d"/>
    <rect x="20" y="18" width="1160" height="639" rx="12" fill="url(#paper)" stroke="#aa813e" stroke-width="2" filter="url(#shadow)"/>
    <rect x="20" y="18" width="1160" height="639" rx="12" fill="url(#grain)"/>
    <text x="43" y="56" fill="#ead8ad" font-family="Georgia, serif" font-size="27" font-weight="700">Como o mundo nasce</text>
    <text x="1157" y="55" text-anchor="end" fill="#d7ac61" font-family="Georgia, serif" font-size="18">${escapeXml(frame.title)}</text>
    <g clip-path="url(#map)">
      <rect x="${MAP_VIEWPORT.x}" y="${MAP_VIEWPORT.y}" width="${MAP_VIEWPORT.width}" height="${MAP_VIEWPORT.height}" fill="#e3d1a7"/>
      ${biomeLayer(snapshot, bounds)}
      <rect x="${MAP_VIEWPORT.x}" y="${MAP_VIEWPORT.y}" width="${MAP_VIEWPORT.width}" height="${MAP_VIEWPORT.height}" fill="url(#grain)" opacity=".8"/>
      ${overlays}
    </g>
    <rect x="${MAP_VIEWPORT.x}" y="${MAP_VIEWPORT.y}" width="${MAP_VIEWPORT.width}" height="${MAP_VIEWPORT.height}" rx="9" fill="none" stroke="#70552d" stroke-width="2"/>
    <text x="43" y="638" fill="#d8c596" font-family="Georgia, serif" font-size="16">${escapeXml(details)}</text>
    <text x="1157" y="638" text-anchor="end" fill="#ab9b79" font-family="Georgia, serif" font-size="13">seed fixa · geração real</text>
  </svg>`;
}

function repeat(frame: Frame, amount: number): Frame[] {
  return Array.from({ length: amount }, () => frame);
}

async function main(): Promise<void> {
  const snapshots: WorldGenerationSnapshot[] = [];
  const world = generateDailyWorld({
    date: DATE,
    seed: SEED,
    catalog: loadBundledCatalog(),
    observer: (snapshot) => snapshots.push(snapshot),
  });
  const section = generateMediumMap(world);
  const selected = snapshots.filter((snapshot) => snapshot.attempt === world.report.attempt);
  const biome = selected.find((snapshot) => snapshot.phase === "biome-field");
  const chunks = selected.find((snapshot) => snapshot.phase === "chunks");
  const completed = selected.find((snapshot) => snapshot.phase === "attempt-complete");
  const placed = selected.filter((snapshot) => snapshot.phase === "word-placed");
  if (!biome || !chunks || !completed || placed.length === 0) {
    throw new Error("Observador não entregou todas as etapas da geração");
  }

  const progression = placed.filter(
    (_, index) => index === 0 || (index + 1) % 7 === 0 || index === placed.length - 1,
  );
  const frames: Frame[] = [
    ...repeat({ snapshot: biome, title: "1 · Campo de biomas" }, 5),
    ...repeat({ snapshot: chunks, title: "2 · Grafo de chunks" }, 5),
    ...progression.map((snapshot) => ({
      snapshot,
      title: `3 · Rotas ${snapshot.words.length}/${world.words.length}`,
    })),
    ...repeat({ snapshot: completed, title: "3 · Mundo global" }, 4),
    ...repeat({ snapshot: completed, title: "4 · Seção Medium", section }, 7),
  ];
  const bounds = fitBounds(world.bounds);
  const temporary = await mkdtemp(join(tmpdir(), "cruzaverso-worldgen-"));
  const output = resolve("docs/assets/worldgen.gif");
  await mkdir(resolve("docs/assets"), { recursive: true });

  try {
    for (const [index, frame] of frames.entries()) {
      await writeFile(join(temporary, `frame-${String(index).padStart(3, "0")}.svg`), render(frame, bounds));
    }
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        "4",
        "-i",
        join(temporary, "frame-%03d.svg"),
        "-filter_complex",
        "split[a][b];[a]palettegen=max_colors=144:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
        "-loop",
        "0",
        output,
      ],
      { stdio: "inherit" },
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("ffmpeg é necessário para gerar docs/assets/worldgen.gif");
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  process.stdout.write(`GIF criado: ${output} (${frames.length} quadros)\n`);
}

await main();
