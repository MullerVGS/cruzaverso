import { useMemo } from "react";

import { SeededRandom } from "../generation/random.js";
import { cellsForWord, type DailyMap } from "../generation/types.js";
import { sketchBlob, sketchCircle, sketchPolyline, type Point } from "../render/sketch.js";

interface FogChartProps {
  map: DailyMap;
  cell: number;
  bleed: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Ponto já reservado por uma peça de mobília, com o raio que ela ocupa. */
interface Placement extends Point {
  extent: number;
}

/** Ponto candidato da lousa, com a folga até a letra mais próxima. */
interface Spot extends Point {
  clearance: number;
}

type OrnamentKind = "ilha" | "serpente" | "navio" | "redemoinho" | "ondas";

const ORNAMENT_KINDS: readonly OrnamentKind[] = ["ilha", "serpente", "navio", "redemoinho", "ondas"];

/** Quantos rumos saem de cada nó. Dezesseis é o número da carta portulana. */
const RHUMB_RAYS = 16;

/** Pontas da rosa: 4 cardeais, 4 colaterais e 8 meios-ventos. */
const ROSE_POINTS = 16;

/** Raio onde ficam os rótulos cardeais, em múltiplos do raio da rosa. */
const ROSE_LABEL_RING = 1.32;

/** Meia altura do rótulo, que é fixo no CSS e por isso não encolhe com a rosa. */
const ROSE_LABEL_HALF = 12;

/** Raio que a rosa inteira ocupa, rótulos incluídos. */
function roseExtent(radius: number): number {
  return radius * ROSE_LABEL_RING + ROSE_LABEL_HALF;
}

const ROSE_LABELS = [
  { label: "N", angle: -Math.PI / 2 },
  { label: "L", angle: 0 },
  { label: "S", angle: Math.PI / 2 },
  { label: "O", angle: Math.PI },
] as const;

/** Passo largo: numa linha de régua o tremor tem onda longa, não serrilha. */
const GRATICULE_STROKE = { roughness: 2.6, passes: 1, step: 64 } as const;

const RHUMB_STROKE = { roughness: 1.6, passes: 1, step: 96 } as const;

/** Sorteio estável a partir do id do mapa: mesma edição, mesma carta. */
function seededSequence(seed: string, count: number): number[] {
  const random = new SeededRandom(seed);
  return Array.from({ length: count }, () => random.float());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Quanto o ponto está fora da caixa; zero se está dentro. */
function outsideDistance(point: Point, box: Box): number {
  const dx = Math.max(box.left - point.x, 0, point.x - box.right);
  const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
  return Math.hypot(dx, dy);
}

/** Distância do ponto interno até a borda da caixa, seguindo o ângulo. */
function rayReach(origin: Point, angle: number, box: Box): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let reach = Number.POSITIVE_INFINITY;
  if (cos > 1e-6) reach = Math.min(reach, (box.right - origin.x) / cos);
  if (cos < -1e-6) reach = Math.min(reach, (box.left - origin.x) / cos);
  if (sin > 1e-6) reach = Math.min(reach, (box.bottom - origin.y) / sin);
  if (sin < -1e-6) reach = Math.min(reach, (box.top - origin.y) / sin);
  return Number.isFinite(reach) ? Math.max(0, reach) : 0;
}

/**
 * Lugares vazios da carta. A folga é medida contra as células de palavra de
 * verdade, não contra o retângulo do recorte: a mobília pesada escolhe daqui
 * e por construção nunca cai sobre a cruzadinha.
 */
function emptySpots(map: DailyMap, cell: number, canvas: Box): Spot[] {
  const letters: Point[] = [];
  for (const word of map.words) {
    for (const position of cellsForWord(word)) {
      letters.push({ x: position.x * cell + cell / 2, y: position.y * cell + cell / 2 });
    }
  }
  const openSea = Math.hypot(canvas.right - canvas.left, canvas.bottom - canvas.top);
  const stride = cell * 1.5;
  const spots: Spot[] = [];
  for (let x = canvas.left + stride / 2; x <= canvas.right; x += stride) {
    for (let y = canvas.top + stride / 2; y <= canvas.bottom; y += stride) {
      let nearest = openSea;
      for (const letter of letters) {
        const distance = Math.hypot(letter.x - x, letter.y - y);
        if (distance < nearest) nearest = distance;
      }
      // Meia diagonal da célula: a folga vale até a borda da letra, não ao centro.
      spots.push({ x, y, clearance: nearest - cell * 0.71 });
    }
  }
  return spots;
}

/**
 * Reserva um lugar para uma peça de raio `extent`. A peça precisa caber inteira
 * dentro de `bounds`; entre as que cabem, mar aberto vence — a carta antiga põe
 * a mobília longe do texto — e sair do retângulo visível ainda custa.
 */
function takeSpot(
  spots: readonly Spot[],
  extent: number,
  bounds: Box,
  grid: Box,
  taken: readonly Placement[],
  roll: number,
  pool: number,
  spread = 0,
): Placement | null {
  const fits = spots.filter((spot) => {
    if (spot.clearance < extent) return false;
    if (spot.x - extent < bounds.left || spot.x + extent > bounds.right) return false;
    if (spot.y - extent < bounds.top || spot.y + extent > bounds.bottom) return false;
    return taken.every(
      (other) => Math.hypot(other.x - spot.x, other.y - spot.y) >= other.extent + extent + spread,
    );
  });
  if (fits.length === 0) return null;
  const centerX = (grid.left + grid.right) / 2;
  const centerY = (grid.top + grid.bottom) / 2;
  // Folga tem retorno decrescente: passado o dobro do próprio tamanho a peça já
  // está sozinha, e o que decide é ficar na borda do recorte — sem sair dele,
  // que é onde o sangramento pode não caber na tela.
  const score = (spot: Spot): number =>
    Math.min(spot.clearance, extent * 2) +
    Math.hypot(spot.x - centerX, spot.y - centerY) * 0.4 -
    outsideDistance(spot, grid) * 1.8;
  const ranked = [...fits].sort((a, b) => score(b) - score(a));
  const shortlist = ranked.slice(0, Math.max(1, Math.min(pool, ranked.length)));
  const chosen = shortlist[Math.min(shortlist.length - 1, Math.floor(roll * shortlist.length))] as Spot;
  return { x: chosen.x, y: chosen.y, extent };
}

interface RosePoint {
  d: string;
  cardinal: boolean;
  major: boolean;
}

/** As pontas da rosa: cardeais longas, colaterais médias, meios-ventos finos. */
function rosePoints(center: Point, radius: number, seed: string): RosePoint[] {
  return Array.from({ length: ROSE_POINTS }, (_, index) => {
    const angle = -Math.PI / 2 + (index / ROSE_POINTS) * Math.PI * 2;
    const major = index % 2 === 0;
    const cardinal = index % 4 === 0;
    const reach = cardinal ? radius : major ? radius * 0.7 : radius * 0.46;
    // Meios-ventos são agulhas: base estreita, para as dezesseis pontas não
    // virarem uma mancha sólida no centro.
    const spread = major ? Math.PI / 8 : Math.PI / 40;
    const base = major ? radius * 0.18 : radius * 0.3;
    const corner = (offset: number, distance: number): Point => ({
      x: center.x + Math.cos(angle + offset) * distance,
      y: center.y + Math.sin(angle + offset) * distance,
    });
    return {
      cardinal,
      major,
      d: sketchPolyline(
        [center, corner(-spread, base), corner(0, reach), corner(spread, base)],
        `${seed}:ponta:${index}`,
        { roughness: 0.7, passes: 1, step: Math.max(10, radius / 4), closed: true },
      ),
    };
  });
}

/** Anel de graus: trinta e dois traços curtos, longos de quatro em quatro. */
function roseTicks(center: Point, radius: number, seed: string): string {
  const wobble = seededSequence(`${seed}:graus`, 64);
  const commands: string[] = [];
  for (let index = 0; index < 32; index += 1) {
    const angle = -Math.PI / 2 + (index / 32) * Math.PI * 2;
    const inner = radius * 1.05 + ((wobble[index * 2] as number) - 0.5) * 1.6;
    const outer = radius * (index % 4 === 0 ? 1.19 : 1.13) + ((wobble[index * 2 + 1] as number) - 0.5) * 1.6;
    commands.push(
      `M${round(center.x + Math.cos(angle) * inner)} ${round(center.y + Math.sin(angle) * inner)}` +
        ` L${round(center.x + Math.cos(angle) * outer)} ${round(center.y + Math.sin(angle) * outer)}`,
    );
  }
  return commands.join(" ");
}

function drawIsland(center: Point, size: number, seed: string): string[] {
  const roll = seededSequence(`${seed}:ilha`, 6);
  const paths = [
    sketchBlob(center.x, center.y, size * 0.8, `${seed}:costa`, 0.3),
    sketchBlob(center.x - size * 0.1, center.y - size * 0.12, size * 0.4, `${seed}:relevo`, 0.34),
  ];
  for (let index = 0; index < 2; index += 1) {
    const angle = (roll[index] as number) * Math.PI * 2;
    const distance = size * (0.95 + (roll[index + 2] as number) * 0.15);
    paths.push(
      sketchBlob(
        center.x + Math.cos(angle) * distance,
        center.y + Math.sin(angle) * distance,
        size * (0.1 + (roll[index + 4] as number) * 0.07),
        `${seed}:ilhota:${index}`,
        0.35,
      ),
    );
  }
  return paths;
}

function drawSerpent(center: Point, size: number, seed: string): string[] {
  const humpRadius = size * 0.34;
  const waterline = center.y + size * 0.25;
  const firstHump = center.x - size * 0.8;
  const paths: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const humpCenter = firstHump + index * humpRadius * 2.1;
    const arch = Array.from({ length: 9 }, (_, step) => {
      const angle = Math.PI + (step / 8) * Math.PI;
      return { x: humpCenter + Math.cos(angle) * humpRadius, y: waterline + Math.sin(angle) * humpRadius * 0.85 };
    });
    paths.push(sketchPolyline(arch, `${seed}:lombo:${index}`, { roughness: 0.8, passes: 1, step: humpRadius / 2 }));
  }
  const headX = center.x + size * 0.62;
  const headY = waterline - size * 0.62;
  paths.push(
    sketchPolyline(
      [
        { x: firstHump + 2 * humpRadius * 2.1 + humpRadius, y: waterline },
        { x: headX - size * 0.12, y: headY + size * 0.24 },
      ],
      `${seed}:pescoco`,
      { roughness: 0.9, passes: 1, step: size / 3 },
    ),
  );
  paths.push(sketchBlob(headX, headY, size * 0.2, `${seed}:cabeca`, 0.28));
  paths.push(
    sketchPolyline(
      [
        { x: headX + size * 0.16, y: headY - size * 0.12 },
        { x: headX + size * 0.42, y: headY - size * 0.18 },
        { x: headX + size * 0.18, y: headY + size * 0.06 },
      ],
      `${seed}:boca`,
      { roughness: 0.6, passes: 1, step: size / 4 },
    ),
  );
  paths.push(
    sketchPolyline(
      [
        { x: firstHump - humpRadius, y: waterline },
        { x: center.x - size * 1.05, y: waterline - size * 0.32 },
        { x: center.x - size * 0.76, y: waterline - size * 0.18 },
      ],
      `${seed}:cauda`,
      { roughness: 0.7, passes: 1, step: size / 4 },
    ),
  );
  return paths;
}

function drawShip(center: Point, size: number, seed: string): string[] {
  const deck = center.y + size * 0.45;
  const half = size * 0.62;
  const paths = [
    sketchPolyline(
      [
        { x: center.x - half, y: deck },
        { x: center.x - half * 0.7, y: deck + size * 0.34 },
        { x: center.x + half * 0.7, y: deck + size * 0.34 },
        { x: center.x + half, y: deck },
      ],
      `${seed}:casco`,
      { roughness: 0.8, passes: 1, step: size / 3, closed: true },
    ),
    sketchPolyline([{ x: center.x, y: deck }, { x: center.x, y: center.y - size * 0.95 }], `${seed}:mastro`, {
      roughness: 0.6,
      passes: 1,
      step: size / 2,
    }),
  ];
  const sails: Array<[number, number, number]> = [
    [center.y - size * 0.84, center.y - size * 0.44, 0.3],
    [center.y - size * 0.32, center.y + size * 0.16, 0.42],
  ];
  for (const [top, bottom, spread] of sails) {
    paths.push(
      sketchPolyline(
        [
          { x: center.x - size * spread, y: top },
          { x: center.x + size * spread, y: top },
          { x: center.x + size * spread * 1.16, y: bottom },
          { x: center.x - size * spread * 1.16, y: bottom },
        ],
        `${seed}:vela:${round(top)}`,
        { roughness: 0.7, passes: 1, step: size / 3, closed: true },
      ),
    );
  }
  paths.push(
    sketchPolyline(
      [
        { x: center.x, y: center.y - size * 0.95 },
        { x: center.x + size * 0.3, y: center.y - size * 0.86 },
        { x: center.x, y: center.y - size * 0.76 },
      ],
      `${seed}:galhardete`,
      { roughness: 0.5, passes: 1, step: size / 4 },
    ),
  );
  return paths;
}

function drawWhirl(center: Point, size: number, seed: string): string[] {
  const steps = 38;
  const arm = Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const angle = t * 2.6 * Math.PI * 2;
    const radius = size * (0.08 + t * 0.72);
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * 0.78 };
  });
  const paths = [sketchPolyline(arm, `${seed}:espiral`, { roughness: 0.7, passes: 1, step: size / 3 })];
  for (let index = 0; index < 2; index += 1) {
    const start = index * Math.PI + 0.6;
    const streak = Array.from({ length: 5 }, (_, step) => {
      const angle = start + (step / 4) * 0.9;
      const radius = size * (0.9 + step * 0.05);
      return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * 0.78 };
    });
    paths.push(sketchPolyline(streak, `${seed}:corrente:${index}`, { roughness: 0.6, passes: 1, step: size / 3 }));
  }
  return paths;
}

function drawWaves(center: Point, size: number, seed: string): string[] {
  const roll = seededSequence(`${seed}:ondas`, 8);
  return Array.from({ length: 4 }, (_, index) => {
    const originX = center.x + ((roll[index] as number) - 0.5) * size * 1.3;
    const originY = center.y + ((roll[index + 4] as number) - 0.5) * size * 1.2;
    const reach = size * 0.46;
    const crest = Array.from({ length: 9 }, (_, step) => {
      const t = step / 8;
      return { x: originX - reach + t * reach * 2, y: originY - Math.sin(t * Math.PI * 2) * reach * 0.34 };
    });
    return sketchPolyline(crest, `${seed}:onda:${index}`, { roughness: 0.5, passes: 1, step: reach / 3 });
  });
}

function drawOrnament(kind: OrnamentKind, center: Point, size: number, seed: string): string[] {
  if (kind === "ilha") return drawIsland(center, size, seed);
  if (kind === "serpente") return drawSerpent(center, size, seed);
  if (kind === "navio") return drawShip(center, size, seed);
  if (kind === "redemoinho") return drawWhirl(center, size, seed);
  return drawWaves(center, size, seed);
}

/**
 * A mobília da carta náutica. Vive dentro da máscara de névoa: onde o jogador
 * já explorou ela some, e a grade fica limpa.
 */
export function FogChart({ map, cell, bleed }: FogChartProps) {
  const chart = useMemo(() => {
    const canvas: Box = {
      left: (map.bounds.minX - bleed) * cell,
      top: (map.bounds.minY - bleed) * cell,
      right: (map.bounds.maxX + 1 + bleed) * cell,
      bottom: (map.bounds.maxY + 1 + bleed) * cell,
    };
    // O retângulo do recorte é o que a câmera garante em tela no zoom 1.
    const grid: Box = {
      left: map.bounds.minX * cell,
      top: map.bounds.minY * cell,
      right: (map.bounds.maxX + 1) * cell,
      bottom: (map.bounds.maxY + 1) * cell,
    };
    const width = canvas.right - canvas.left;
    const height = canvas.bottom - canvas.top;
    const roll = seededSequence(`${map.id}:carta`, 24);
    const spots = emptySpots(map, cell, canvas);
    const taken: Placement[] = [];

    // Rosa dos ventos: encolhe até caber num vazio de verdade, em vez de
    // aterrissar num percentual fixo que pode dar bem em cima da cruzadinha.
    // Cabe inteira no recorte porque só ele é garantido em tela: o sangramento
    // aparece ou não conforme a proporção do quadro, e a rosa não pode sumir.
    const wishedRadius = clamp(Math.min(width, height) * 0.075, cell * 1.5, cell * 2.8);
    let rose: (Placement & { radius: number }) | null = null;
    for (const bounds of [grid, canvas]) {
      for (const shrink of [1, 0.82, 0.66, 0.5]) {
        const radius = wishedRadius * shrink;
        const placement = takeSpot(spots, roseExtent(radius), bounds, grid, taken, roll[0] as number, 14);
        if (placement) {
          rose = { ...placement, radius };
          break;
        }
      }
      if (rose) break;
    }
    if (rose) taken.push(rose);

    // Nós de rumo: os outros focos do feixe portulano. Como a rosa, ficam em
    // mar aberto; só as linhas atravessam a carta inteira.
    const rhumbNodes: Placement[] = [];
    const nodeReach = Math.min(width, height);
    for (let index = 0; index < 2; index += 1) {
      // O afastamento é requisito de composição, não de folga: sem ele os três
      // focos nascem juntos e o feixe vira um leque só.
      for (const spread of [0.3, 0.2, 0.1, 0]) {
        const node = takeSpot(spots, cell * 2, canvas, grid, taken, roll[1 + index] as number, 26, nodeReach * spread);
        if (node) {
          rhumbNodes.push(node);
          taken.push(node);
          break;
        }
      }
    }

    const rhumbOrigins: Array<Point & { radius: number }> = [
      ...(rose ? [{ x: rose.x, y: rose.y, radius: rose.radius * 1.13 }] : []),
      ...rhumbNodes.map((node) => ({ x: node.x, y: node.y, radius: cell * 0.42 })),
    ];

    const spacing = cell * 6;
    const graticule: Array<{ d: string; seed: string }> = [];
    // Alinhado à origem do mundo: o graticulado coincide com as linhas de
    // célula e não nasce colado na borda da lousa.
    for (let index = Math.ceil(canvas.left / spacing); index <= Math.floor(canvas.right / spacing); index += 1) {
      const x = index * spacing;
      const seed = `${map.id}:meridiano:${index}`;
      graticule.push({
        seed,
        d: sketchPolyline([{ x, y: canvas.top }, { x, y: canvas.bottom }], seed, GRATICULE_STROKE),
      });
    }
    for (let index = Math.ceil(canvas.top / spacing); index <= Math.floor(canvas.bottom / spacing); index += 1) {
      const y = index * spacing;
      const seed = `${map.id}:paralelo:${index}`;
      graticule.push({
        seed,
        d: sketchPolyline([{ x: canvas.left, y }, { x: canvas.right, y }], seed, GRATICULE_STROKE),
      });
    }

    // Rumos e rosa saem prontos daqui: o MapView redesenha a cada quadro de
    // arrasto, e refazer mil pontos de traço por quadro não se paga.
    const rhumbs: Array<{ d: string; seed: string }> = [];
    const nodes: Array<{ d: string; seed: string }> = [];
    for (const [originIndex, origin] of rhumbOrigins.entries()) {
      for (let ray = 0; ray < RHUMB_RAYS; ray += 1) {
        const angle = (ray / RHUMB_RAYS) * Math.PI * 2;
        // Aparado na borda da lousa: sem isso metade de cada rumo é desenhada
        // fora do quadro e só custa pontos.
        const reach = rayReach(origin, angle, canvas);
        if (reach <= origin.radius) continue;
        const seed = `${map.id}:rumo:${originIndex}:${ray}`;
        rhumbs.push({
          seed,
          d: sketchPolyline(
            [
              { x: origin.x + Math.cos(angle) * origin.radius, y: origin.y + Math.sin(angle) * origin.radius },
              { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach },
            ],
            seed,
            RHUMB_STROKE,
          ),
        });
      }
      if (originIndex === 0 && rose) continue;
      const seed = `${map.id}:no:${originIndex}`;
      nodes.push({ seed, d: sketchCircle(origin.x, origin.y, origin.radius, seed, { roughness: 0.8, passes: 1 }) });
    }

    const roseArt = rose
      ? {
          rings: [1.05, 1.13].map((factor, index) => ({
            seed: `${map.id}:rosa:anel:${index}`,
            d: sketchCircle(rose.x, rose.y, rose.radius * factor, `${map.id}:rosa:anel:${index}`, {
              roughness: 0.9,
              passes: 1,
            }),
          })),
          ticks: roseTicks(rose, rose.radius, `${map.id}:rosa`),
          points: rosePoints(rose, rose.radius, `${map.id}:rosa`),
          hub: sketchCircle(rose.x, rose.y, rose.radius * 0.12, `${map.id}:rosa:eixo`, {
            roughness: 0.6,
            passes: 1,
          }),
          labels: ROSE_LABELS.map(({ label, angle }) => ({
            label,
            x: round(rose.x + Math.cos(angle) * rose.radius * ROSE_LABEL_RING),
            y: round(rose.y + Math.sin(angle) * rose.radius * ROSE_LABEL_RING),
          })),
        }
      : null;

    // Ornamento pode encostar na moldura, mas não atravessá-la: metade de um
    // navio pendurada na borda do quadro é acidente, não decisão de desenho.
    const ornamentBounds: Box = {
      left: grid.left - cell,
      top: grid.top - cell,
      right: grid.right + cell,
      bottom: grid.bottom + cell,
    };
    const ornamentSize = clamp(Math.min(width, height) * 0.035, cell * 0.9, cell * 1.6);
    const ornamentCount = 3 + ((roll[3] as number) < 0.5 ? 0 : 1);
    const kindOffset = Math.floor((roll[4] as number) * ORNAMENT_KINDS.length);
    const ornaments: Array<{ kind: OrnamentKind; paths: string[]; seed: string }> = [];
    for (let index = 0; index < ornamentCount; index += 1) {
      const kind = ORNAMENT_KINDS[(kindOffset + index) % ORNAMENT_KINDS.length] as OrnamentKind;
      const size = ornamentSize * (0.82 + (roll[8 + index] as number) * 0.5);
      const placement = takeSpot(spots, size * 1.35, ornamentBounds, grid, taken, roll[16 + index] as number, 30);
      if (!placement) continue;
      taken.push(placement);
      const seed = `${map.id}:ornamento:${index}`;
      ornaments.push({ kind, seed, paths: drawOrnament(kind, placement, size, seed) });
    }

    return { graticule, rhumbs, nodes, rose: roseArt, ornaments };
  }, [bleed, cell, map]);

  const rose = chart.rose;

  return (
    <g className="fog-chart" aria-hidden="true" pointerEvents="none">
      <g className="chart-graticule">
        {chart.graticule.map((line) => (
          <path key={line.seed} d={line.d} />
        ))}
      </g>

      <g className="chart-rhumbs">
        {chart.rhumbs.map((line) => (
          <path key={line.seed} d={line.d} />
        ))}
        {chart.nodes.map((node) => (
          <path key={node.seed} className="rhumb-node" d={node.d} />
        ))}
      </g>

      {rose ? (
        <g className="chart-rose">
          {rose.rings.map((ring) => (
            <path key={ring.seed} className="rose-ring" d={ring.d} />
          ))}
          <path className="rose-ticks" d={rose.ticks} />
          {rose.points.map((point, index) => (
            <path
              key={`ponta-${index}`}
              className={`rose-point ${point.cardinal ? "is-cardinal" : point.major ? "is-major" : "is-minor"}`}
              d={point.d}
            />
          ))}
          <path className="rose-hub" d={rose.hub} />
          {rose.labels.map(({ label, x, y }) => (
            <text key={label} className="rose-label" x={x} y={y} dominantBaseline="central">
              {label}
            </text>
          ))}
        </g>
      ) : null}

      <g className="chart-ornaments">
        {chart.ornaments.map((ornament) => (
          <g key={ornament.seed} className={`chart-ornament is-${ornament.kind}`}>
            {ornament.paths.map((d, index) => (
              <path key={`${ornament.seed}:${index}`} d={d} />
            ))}
          </g>
        ))}
      </g>
    </g>
  );
}
