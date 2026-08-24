import { BIOMES, type BiomeId, type ContentCatalog, type ContentEntry } from "../content/catalog.js";
import { GAME_BALANCE } from "../config/game.js";
import { SeededRandom, seedFingerprint } from "./random.js";
import {
  cellsForWord,
  coordinateKey,
  type BiomeSite,
  type Bounds,
  type DailyWorld,
  type Orientation,
  type PlacedWord,
  type WorldChunk,
} from "./types.js";

export interface WorldGenerationConfig {
  targetWords: number;
  attempts: number;
  chunkCount: number;
}

export interface GenerateWorldInput {
  date: string;
  seed?: string;
  catalog: ContentCatalog;
  config?: Partial<WorldGenerationConfig>;
}

const DEFAULT_CONFIG: WorldGenerationConfig = {
  ...GAME_BALANCE.world,
};

interface IndexedCell {
  letter: string;
  words: string[];
  orientations: Orientation[];
}

interface PlacementOption {
  entry: ContentEntry;
  orientation: Orientation;
  start: { x: number; y: number };
  biome: BiomeId;
  crossings: number;
  score: number;
}

function biomeAt(sites: readonly BiomeSite[], x: number, y: number): BiomeId {
  let winner = sites[0];
  if (!winner) {
    throw new Error("Campo de biomas vazio");
  }
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    const distance = (site.x - x) ** 2 + (site.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      winner = site;
    }
  }
  return winner.biome;
}

function buildBiomeSites(random: SeededRandom): BiomeSite[] {
  const sites: BiomeSite[] = BIOMES.map((biome, index) => ({
    id: `biome-${index}-${biome}`,
    biome,
    x: random.int(-26, 27),
    y: random.int(-20, 21),
    radius: random.int(18, 31),
  }));
  for (let index = 0; index < 3; index += 1) {
    const biome = random.pick(BIOMES);
    sites.push({
      id: `biome-extra-${index}-${biome}`,
      biome,
      x: random.int(-34, 35),
      y: random.int(-26, 27),
      radius: random.int(15, 28),
    });
  }
  return sites;
}

function buildChunks(random: SeededRandom, sites: readonly BiomeSite[], count: number): WorldChunk[] {
  const coordinates = new Map<string, { x: number; y: number }>();
  coordinates.set("0,0", { x: 0, y: 0 });
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  let guard = 0;
  while (coordinates.size < count && guard < count * 80) {
    guard += 1;
    const origin = random.pick([...coordinates.values()]);
    const direction = random.pick(directions);
    const next = { x: origin.x + direction.x, y: origin.y + direction.y };
    coordinates.set(coordinateKey(next), next);
  }

  const chunks: WorldChunk[] = [...coordinates.values()].map((coordinate, index) => {
    const x = coordinate.x * 11;
    const y = coordinate.y * 9;
    return {
      id: `chunk-${index}`,
      x,
      y,
      biome: biomeAt(sites, x, y),
      neighbors: [],
    };
  });

  for (const chunk of chunks) {
    for (const other of chunks) {
      if (chunk === other) continue;
      const gridDistance = Math.abs(chunk.x - other.x) / 11 + Math.abs(chunk.y - other.y) / 9;
      if (gridDistance === 1) chunk.neighbors.push(other.id);
    }
    chunk.neighbors.sort();
  }
  return chunks;
}

function indexWords(words: readonly PlacedWord[]): Map<string, IndexedCell> {
  const index = new Map<string, IndexedCell>();
  for (const word of words) {
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      const existing = index.get(key) ?? { letter: cell.letter, words: [], orientations: [] };
      existing.words.push(word.id);
      existing.orientations.push(word.orientation);
      index.set(key, existing);
    }
  }
  return index;
}

function inspectPlacement(
  entry: ContentEntry,
  orientation: Orientation,
  start: { x: number; y: number },
  cells: ReadonlyMap<string, IndexedCell>,
): { valid: boolean; crossings: number } {
  let crossings = 0;
  const candidate = { gridAnswer: entry.gridAnswer, orientation, start };
  for (const cell of cellsForWord(candidate)) {
    const occupied = cells.get(coordinateKey(cell));
    if (occupied) {
      if (
        occupied.letter !== cell.letter ||
        occupied.orientations.includes(orientation) ||
        occupied.orientations.length >= 2
      ) {
        return { valid: false, crossings: 0 };
      }
      crossings += 1;
      continue;
    }

    const neighbors =
      orientation === "horizontal"
        ? [
            { x: cell.x, y: cell.y - 1 },
            { x: cell.x, y: cell.y + 1 },
          ]
        : [
            { x: cell.x - 1, y: cell.y },
            { x: cell.x + 1, y: cell.y },
          ];
    if (neighbors.some((neighbor) => cells.has(coordinateKey(neighbor)))) {
      return { valid: false, crossings: 0 };
    }
  }

  const before = {
    x: start.x - (orientation === "horizontal" ? 1 : 0),
    y: start.y - (orientation === "vertical" ? 1 : 0),
  };
  const after = {
    x: start.x + (orientation === "horizontal" ? entry.gridAnswer.length : 0),
    y: start.y + (orientation === "vertical" ? entry.gridAnswer.length : 0),
  };
  if (cells.has(coordinateKey(before)) || cells.has(coordinateKey(after))) {
    return { valid: false, crossings: 0 };
  }

  return { valid: crossings > 0, crossings };
}

function toPlacedWord(
  entry: ContentEntry,
  index: number,
  orientation: Orientation,
  start: { x: number; y: number },
  biome: BiomeId,
): PlacedWord {
  return {
    id: `word-${index}-${entry.id}`,
    entryId: entry.id,
    answer: entry.answer,
    gridAnswer: entry.gridAnswer,
    clues: entry.clues,
    difficulty: entry.difficulty,
    familiarity: entry.familiarity,
    biome,
    orientation,
    start,
  };
}

function candidateOptions(
  catalog: ContentCatalog,
  words: readonly PlacedWord[],
  used: ReadonlySet<string>,
  sites: readonly BiomeSite[],
  targetChunk: WorldChunk,
  random: SeededRandom,
): PlacementOption[] {
  const cellIndex = indexWords(words);
  const options: PlacementOption[] = [];

  for (const anchor of words) {
    const orientation: Orientation = anchor.orientation === "horizontal" ? "vertical" : "horizontal";
    for (const anchorCell of cellsForWord(anchor)) {
      for (const { entry, positions } of catalog.findByLetter(anchorCell.letter)) {
        if (used.has(entry.id)) continue;
        for (const position of positions) {
          const start = {
            x: anchorCell.x - (orientation === "horizontal" ? position : 0),
            y: anchorCell.y - (orientation === "vertical" ? position : 0),
          };
          const middle = {
            x: start.x + (orientation === "horizontal" ? (entry.gridAnswer.length - 1) / 2 : 0),
            y: start.y + (orientation === "vertical" ? (entry.gridAnswer.length - 1) / 2 : 0),
          };
          const biome = biomeAt(sites, middle.x, middle.y);
          if (!entry.biomes.includes(biome)) continue;
          const inspected = inspectPlacement(entry, orientation, start, cellIndex);
          if (!inspected.valid) continue;

          const chunkDistance = Math.abs(targetChunk.x - middle.x) + Math.abs(targetChunk.y - middle.y);
          const spread = Math.min(18, Math.abs(middle.x) + Math.abs(middle.y));
          options.push({
            entry,
            orientation,
            start,
            biome,
            crossings: inspected.crossings,
            score: inspected.crossings * 45 - chunkDistance * 0.45 + spread * 0.08 + random.float(),
          });
        }
      }
    }
  }
  options.sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
  return options.slice(0, 80);
}

function calculateBounds(words: readonly PlacedWord[]): Bounds {
  const cells = words.flatMap((word) => cellsForWord(word));
  return {
    minX: Math.min(...cells.map((cell) => cell.x)),
    minY: Math.min(...cells.map((cell) => cell.y)),
    maxX: Math.max(...cells.map((cell) => cell.x)),
    maxY: Math.max(...cells.map((cell) => cell.y)),
  };
}

function countCrossings(words: readonly PlacedWord[]): number {
  const counts = new Map<string, number>();
  for (const word of words) {
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function buildAttempt(
  date: string,
  seed: string,
  attempt: number,
  catalog: ContentCatalog,
  config: WorldGenerationConfig,
): DailyWorld {
  const random = new SeededRandom(`${seed}:attempt:${attempt}`);
  const biomeSites = buildBiomeSites(random.fork("biomes"));
  const chunks = buildChunks(random.fork("chunks"), biomeSites, config.chunkCount);
  const originBiome = biomeAt(biomeSites, 0, 0);
  const initialEntry = random.pick(catalog.byBiome[originBiome]);
  const initialStart = { x: -Math.floor(initialEntry.gridAnswer.length / 2), y: 0 };
  const words: PlacedWord[] = [
    toPlacedWord(initialEntry, 0, "horizontal", initialStart, originBiome),
  ];
  const used = new Set([initialEntry.id]);

  for (let index = 1; index < config.targetWords; index += 1) {
    const targetChunk = chunks[index % chunks.length] as WorldChunk;
    const options = candidateOptions(catalog, words, used, biomeSites, targetChunk, random);
    if (options.length === 0) break;
    const option = options[random.int(0, Math.min(5, options.length))] as PlacementOption;
    words.push(toPlacedWord(option.entry, index, option.orientation, option.start, option.biome));
    used.add(option.entry.id);
  }

  const crossings = countCrossings(words);
  const cycles = Math.max(0, crossings - words.length + 1);
  const world: DailyWorld = {
    schemaVersion: 1,
    generatorVersion: "1.1.0",
    datasetVersion: "curadoria-v2",
    configVersion: "1.0.0",
    id: `${date}-g1-${seedFingerprint(seed)}`,
    date,
    seed,
    biomeSites,
    chunks,
    words,
    bounds: calculateBounds(words),
    report: {
      valid: false,
      attempt,
      requestedWords: config.targetWords,
      placedWords: words.length,
      crossings,
      cycles,
      score: words.length * 10 + cycles * 25 + crossings,
      errors: [],
    },
    candidateReports: [],
  };
  const errors = validateWorld(world);
  world.report.errors = errors;
  world.report.valid = errors.length === 0;
  if (!world.report.valid) world.report.score -= errors.length * 1_000;
  return world;
}

export function generateDailyWorld(input: GenerateWorldInput): DailyWorld {
  const config = { ...DEFAULT_CONFIG, ...input.config };
  const seed = input.seed ?? `cruzaverso:${input.date}`;
  const candidates = Array.from({ length: config.attempts }, (_, attempt) =>
    buildAttempt(input.date, seed, attempt, input.catalog, config),
  );
  candidates.sort((left, right) => right.report.score - left.report.score || left.report.attempt - right.report.attempt);
  const best = candidates[0];
  if (!best) throw new Error("Nenhum mundo candidato foi gerado");
  best.candidateReports = candidates.map((candidate) => ({ ...candidate.report }));
  return best;
}

export function validateWorld(world: DailyWorld): string[] {
  const errors: string[] = [];
  if (world.words.length === 0) return ["Mundo sem palavras"];

  const entryIds = new Set<string>();
  const cells = new Map<string, Array<{ word: PlacedWord; letter: string }>>();
  for (const word of world.words) {
    if (entryIds.has(word.entryId)) errors.push(`Resposta repetida: ${word.entryId}`);
    entryIds.add(word.entryId);
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      const occupying = cells.get(key) ?? [];
      occupying.push({ word, letter: cell.letter });
      cells.set(key, occupying);
    }
  }

  const adjacency = new Map(world.words.map((word) => [word.id, new Set<string>()]));
  for (const [key, occupying] of cells) {
    if (new Set(occupying.map((item) => item.letter)).size > 1) {
      errors.push(`Letras incompatíveis em ${key}`);
    }
    if (occupying.length > 2) errors.push(`Mais de duas palavras em ${key}`);
    if (occupying.length === 2) {
      const [first, second] = occupying;
      if (first?.word.orientation === second?.word.orientation) {
        errors.push(`Sobreposição paralela em ${key}`);
      }
      if (first && second) {
        adjacency.get(first.word.id)?.add(second.word.id);
        adjacency.get(second.word.id)?.add(first.word.id);
      }
    }
  }

  const visited = new Set<string>();
  const pending = [world.words[0]?.id].filter((id): id is string => Boolean(id));
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const neighbor of adjacency.get(id) ?? []) pending.push(neighbor);
  }
  if (visited.size !== world.words.length) errors.push("Crossword global desconectada");
  return errors;
}
