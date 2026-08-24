import type { BiomeId } from "../content/catalog.js";
import type { BiomeField } from "../generation/biome-field.js";
import type { Bounds } from "../generation/types.js";
import type { Point } from "./sketch.js";

export interface BiomeSample {
  minX: number;
  minY: number;
  width: number;
  height: number;
  step: number;
  at(column: number, row: number): BiomeId;
}

export function sampleBiomeField(field: BiomeField, area: Bounds, step: number): BiomeSample {
  const width = Math.floor((area.maxX - area.minX) / step) + 1;
  const height = Math.floor((area.maxY - area.minY) / step) + 1;
  const cells: BiomeId[] = new Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      cells[row * width + column] = field.biomeAt(area.minX + column * step, area.minY + row * step);
    }
  }
  return {
    minX: area.minX,
    minY: area.minY,
    width,
    height,
    step,
    at(column, row) {
      const clampedColumn = Math.min(width - 1, Math.max(0, column));
      const clampedRow = Math.min(height - 1, Math.max(0, row));
      return cells[clampedRow * width + clampedColumn] as BiomeId;
    },
  };
}

function toWorld(sample: BiomeSample, column: number, row: number): Point {
  return { x: sample.minX + column * sample.step, y: sample.minY + row * sample.step };
}

const pointKey = (point: Point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`;

/**
 * Cada par de amostras vizinhas com biomas diferentes gera um segmento na
 * grade dual — a linha que passa exatamente entre as duas.
 */
function boundarySegments(sample: BiomeSample): Array<[Point, Point]> {
  const segments: Array<[Point, Point]> = [];
  const half = sample.step / 2;
  for (let row = 0; row < sample.height; row += 1) {
    for (let column = 0; column < sample.width; column += 1) {
      const current = sample.at(column, row);
      if (column + 1 < sample.width && sample.at(column + 1, row) !== current) {
        const anchor = toWorld(sample, column, row);
        segments.push([
          { x: anchor.x + half, y: anchor.y - half },
          { x: anchor.x + half, y: anchor.y + half },
        ]);
      }
      if (row + 1 < sample.height && sample.at(column, row + 1) !== current) {
        const anchor = toWorld(sample, column, row);
        segments.push([
          { x: anchor.x - half, y: anchor.y + half },
          { x: anchor.x + half, y: anchor.y + half },
        ]);
      }
    }
  }
  return segments;
}

/** Encadeia segmentos que compartilham extremidade numa polilinha só. */
function chain(segments: Array<[Point, Point]>): Point[][] {
  const byEndpoint = new Map<string, number[]>();
  segments.forEach(([from, to], index) => {
    for (const point of [from, to]) {
      const key = pointKey(point);
      const bucket = byEndpoint.get(key) ?? [];
      bucket.push(index);
      byEndpoint.set(key, bucket);
    }
  });

  const used = new Set<number>();
  const lines: Point[][] = [];

  /** Anda a partir de `start`, consumindo arestas ainda livres. */
  function walk(start: Point): Point[] {
    const path: Point[] = [start];
    let cursor = start;
    for (;;) {
      const next = (byEndpoint.get(pointKey(cursor)) ?? []).find((index) => !used.has(index));
      if (next === undefined) return path;
      used.add(next);
      const segment = segments[next] as [Point, Point];
      const other = pointKey(segment[0]) === pointKey(cursor) ? segment[1] : segment[0];
      path.push(other);
      cursor = other;
    }
  }

  for (let index = 0; index < segments.length; index += 1) {
    if (used.has(index)) continue;
    const [from, to] = segments[index] as [Point, Point];
    // A aresta-semente é consumida aqui para que os dois lados partam livres.
    used.add(index);
    const forward = walk(to);
    const backward = walk(from);
    lines.push([...backward.slice(1).reverse(), from, ...forward]);
  }
  return lines.filter((line) => line.length >= 2);
}

/**
 * Funde passos consecutivos colineares num só. A grade dual só produz passos
 * unitários paralelos aos eixos; sem esta fusão, um trecho reto chega ao
 * Chaikin como dezenas de vértices e sobrevive à suavização como escada.
 */
function collapseCollinear(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const kept: Point[] = [points[0] as Point];
  for (let index = 1; index + 1 < points.length; index += 1) {
    const previous = kept.at(-1) as Point;
    const current = points[index] as Point;
    const next = points[index + 1] as Point;
    const cross =
      (current.x - previous.x) * (next.y - previous.y) - (current.y - previous.y) * (next.x - previous.x);
    if (cross !== 0) kept.push(current);
  }
  kept.push(points.at(-1) as Point);
  return kept;
}

/** Chaikin: cada iteração corta os cantos e dissolve a escada da grade. */
function chaikin(points: readonly Point[], iterations: number): Point[] {
  let current = [...points];
  for (let round = 0; round < iterations; round += 1) {
    if (current.length < 3) return current;
    const next: Point[] = [current[0] as Point];
    for (let index = 0; index + 1 < current.length; index += 1) {
      const from = current[index] as Point;
      const to = current[index + 1] as Point;
      next.push({ x: from.x * 0.75 + to.x * 0.25, y: from.y * 0.75 + to.y * 0.25 });
      next.push({ x: from.x * 0.25 + to.x * 0.75, y: from.y * 0.25 + to.y * 0.75 });
    }
    next.push(current.at(-1) as Point);
    current = next;
  }
  return current;
}

/** Iterações de Chaikin aplicadas à fronteira. Ver `biomeBoundaries`. */
const SMOOTHING_ROUNDS = 2;

/**
 * Fronteiras entre biomas como polilinhas suaves, em coordenadas de mundo
 * (as mesmas de `Bounds`; os vértices caem no meio-passo entre amostras).
 */
export function biomeBoundaries(sample: BiomeSample): Point[][] {
  return chain(boundarySegments(sample))
    .map((line) => chaikin(collapseCollinear(line), SMOOTHING_ROUNDS))
    .filter((line) => line.length >= 2);
}

export interface BiomeRun {
  x: number;
  y: number;
  /**
   * Largura em unidades de mundo — a mesma unidade de `x` e `y`, e não a
   * contagem de amostras. Uma corrida de n amostras com passo `step` mede
   * `n * step`. Quem desenha multiplica x, y e width pelo mesmo tamanho de
   * célula; a altura da corrida é sempre `step`.
   */
  width: number;
}

/**
 * Amostras agrupadas por bioma, comprimidas em corridas horizontais. Emitir um
 * retângulo por amostra colocaria milhares de nós no SVG; a corrida corta isso
 * numa ordem de grandeza sem mudar o desenho.
 */
export function biomeRegions(sample: BiomeSample): Array<{ biome: BiomeId; runs: BiomeRun[] }> {
  const byBiome = new Map<BiomeId, BiomeRun[]>();
  for (let row = 0; row < sample.height; row += 1) {
    let column = 0;
    while (column < sample.width) {
      const biome = sample.at(column, row);
      let end = column + 1;
      while (end < sample.width && sample.at(end, row) === biome) end += 1;
      const anchor = toWorld(sample, column, row);
      const bucket = byBiome.get(biome) ?? [];
      bucket.push({ x: anchor.x, y: anchor.y, width: (end - column) * sample.step });
      byBiome.set(biome, bucket);
      column = end;
    }
  }
  return [...byBiome.entries()].map(([biome, runs]) => ({ biome, runs }));
}

/**
 * Âncora do rótulo: a amostra mais distante de qualquer fronteira, achada com
 * uma BFS multi-origem. O centróide não serve — em região em forma de meia-lua
 * ele cai fora do próprio bioma. A borda da área amostrada também é origem:
 * rótulo colado no recorte fica ilegível, e assim uma região que só toca a
 * borda ainda ganha âncora, no ponto mais central que ela tiver.
 */
export function biomeLabelAnchors(
  sample: BiomeSample,
): Array<{ biome: BiomeId; x: number; y: number; room: number }> {
  const size = sample.width * sample.height;
  const distance = new Int32Array(size).fill(-1);
  const queue: number[] = [];

  for (let row = 0; row < sample.height; row += 1) {
    for (let column = 0; column < sample.width; column += 1) {
      const biome = sample.at(column, row);
      const onEdge =
        column === 0 ||
        row === 0 ||
        column === sample.width - 1 ||
        row === sample.height - 1 ||
        sample.at(column + 1, row) !== biome ||
        sample.at(column - 1, row) !== biome ||
        sample.at(column, row + 1) !== biome ||
        sample.at(column, row - 1) !== biome;
      if (onEdge) {
        const index = row * sample.width + column;
        distance[index] = 0;
        queue.push(index);
      }
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] as number;
    const column = index % sample.width;
    const row = Math.floor(index / sample.width);
    const next = (distance[index] as number) + 1;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= sample.width || nextRow >= sample.height) continue;
      const nextIndex = nextRow * sample.width + nextColumn;
      if (distance[nextIndex] !== -1) continue;
      distance[nextIndex] = next;
      queue.push(nextIndex);
    }
  }

  const best = new Map<BiomeId, { biome: BiomeId; x: number; y: number; room: number }>();
  for (let row = 0; row < sample.height; row += 1) {
    for (let column = 0; column < sample.width; column += 1) {
      const index = row * sample.width + column;
      const biome = sample.at(column, row);
      const room = (distance[index] as number) + 1;
      const current = best.get(biome);
      if (current && current.room >= room) continue;
      const world = toWorld(sample, column, row);
      best.set(biome, { biome, x: world.x, y: world.y, room });
    }
  }
  return [...best.values()];
}
