import { hashString } from "../generation/random.js";

export interface Point {
  x: number;
  y: number;
}

export interface SketchOptions {
  /** Amplitude do desvio, em unidades de usuário. */
  roughness?: number;
  /** Quantas vezes o traço é repetido. Duas passadas dão o aspecto de caneta. */
  passes?: number;
  closed?: boolean;
  /** Distância entre pontos de amostragem ao longo do segmento. */
  step?: number;
}

const DEFAULTS = { roughness: 1.15, passes: 2, closed: false, step: 16 } as const;

/** Ruído estável por (seed, índice): mesma entrada, mesmo desvio, sempre. */
function jitter(seed: number, index: number): number {
  let hash = seed ^ Math.imul(index | 0, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x735a2d97);
  return (((hash ^ (hash >>> 15)) >>> 0) / 4_294_967_296) * 2 - 1;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Reamostra a polilinha em passos regulares, preservando os vértices originais. */
function resample(points: readonly Point[], step: number): Point[] {
  const dense: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index] as Point;
    const to = points[index + 1] as Point;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const divisions = Math.max(1, Math.round(length / step));
    for (let part = 0; part < divisions; part += 1) {
      const t = part / divisions;
      dense.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  const last = points.at(-1);
  if (last) dense.push({ ...last });
  return dense;
}

function pass(points: readonly Point[], seed: number, roughness: number, closed: boolean): string {
  const last = points.length - 1;
  const commands: string[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index] as Point;
    // Extremos ficam presos para que traços vizinhos continuem se encontrando.
    const anchored = !closed && (index === 0 || index === last);
    const previous = points[Math.max(0, index - 1)] as Point;
    const next = points[Math.min(last, index + 1)] as Point;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    // Desvio perpendicular à direção do traço: é o que faz parecer mão, não ruído.
    const amount = anchored ? 0 : jitter(seed, index) * roughness;
    const x = point.x + (-dy / length) * amount;
    const y = point.y + (dx / length) * amount;
    commands.push(`${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`);
  }
  if (closed) commands.push("Z");
  return commands.join(" ");
}

export function sketchPolyline(
  points: readonly Point[],
  seed: string,
  options: SketchOptions = {},
): string {
  const { roughness, passes, closed, step } = { ...DEFAULTS, ...options };
  if (points.length < 2) return "";
  const dense = resample(points, step);
  const base = hashString(seed);
  const drawn: string[] = [];
  for (let index = 0; index < passes; index += 1) {
    drawn.push(pass(dense, base + index * 0x9e37, roughness * (index === 0 ? 1 : 1.35), closed));
  }
  return drawn.join(" ");
}

export function sketchRect(
  x: number,
  y: number,
  width: number,
  height: number,
  seed: string,
  options: SketchOptions = {},
): string {
  return sketchPolyline(
    [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ],
    seed,
    { step: Math.max(6, Math.min(width, height) / 2), ...options, closed: true },
  );
}

export function sketchCircle(
  cx: number,
  cy: number,
  radius: number,
  seed: string,
  options: SketchOptions = {},
): string {
  const steps = Math.max(12, Math.round(radius));
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return sketchPolyline(points, seed, { step: radius, ...options, closed: true });
}

/**
 * Mancha fechada de raio irregular. Usada para aberturas de névoa: um
 * círculo perfeito denuncia a geometria; a mancha parece costa desenhada.
 */
export function sketchBlob(cx: number, cy: number, radius: number, seed: string, wobble = 0.22): string {
  const base = hashString(seed);
  const steps = 16;
  const points: Point[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    // Duas harmônicas: uma lenta dá a silhueta, uma rápida dá a irregularidade.
    const slow = jitter(base, index % steps);
    const fast = jitter(base + 7, (index * 3) % steps);
    const scale = 1 + slow * wobble + fast * wobble * 0.4;
    points.push({ x: cx + Math.cos(angle) * radius * scale, y: cy + Math.sin(angle) * radius * scale });
  }
  points.push({ ...(points[0] as Point) });
  return sketchPolyline(points, `${seed}:contorno`, {
    step: radius / 2,
    roughness: radius * 0.02,
    passes: 1,
    closed: true,
  });
}
