import { type BiomeId } from "../content/catalog.js";
import { hashString } from "./random.js";
import type { BiomeSite, Coordinate } from "./types.js";

/**
 * Parâmetros do campo. Viajam no artefato diário para que o cliente
 * reconstrua exatamente o mesmo campo que o gerador usou.
 */
export interface BiomeFieldSpec {
  seed: number;
  warpFrequency: number;
  warpAmplitude: number;
  octaves: number;
}

const DEFAULT_WARP = {
  warpFrequency: 0.055,
  warpAmplitude: 17,
  octaves: 4,
} as const;

export function biomeFieldSpecFromSeed(seed: string): BiomeFieldSpec {
  return { seed: hashString(seed), ...DEFAULT_WARP };
}

function hashCoordinate(seed: number, x: number, y: number): number {
  let hash = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), hash | 1);
  hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
  return ((hash ^ (hash >>> 14)) >>> 0) / 4_294_967_296;
}

function smoothstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const topLeft = hashCoordinate(seed, x0, y0);
  const topRight = hashCoordinate(seed, x0 + 1, y0);
  const bottomLeft = hashCoordinate(seed, x0, y0 + 1);
  const bottomRight = hashCoordinate(seed, x0 + 1, y0 + 1);
  const top = topLeft + (topRight - topLeft) * fx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
  return top + (bottom - top) * fy;
}

function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(seed + octave * 7919, x * frequency, y * frequency) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / normalization;
}

/** Alcance, em células, da grade memorizada em torno da origem. */
const CACHE_REACH = 512;

/**
 * Chave numérica para a memória do campo. Devolve `undefined` para
 * coordenadas fracionárias ou fora do alcance — essas não são memorizadas.
 */
function cacheKey(x: number, y: number): number | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  if (x < -CACHE_REACH || x > CACHE_REACH || y < -CACHE_REACH || y > CACHE_REACH) return undefined;
  return (x + CACHE_REACH) * (CACHE_REACH * 2 + 1) + (y + CACHE_REACH);
}

export interface BiomeField {
  spec: BiomeFieldSpec;
  sites: readonly BiomeSite[];
  biomeAt(x: number, y: number): BiomeId;
  warp(x: number, y: number): Coordinate;
}

export function createBiomeField(spec: BiomeFieldSpec, sites: readonly BiomeSite[]): BiomeField {
  if (sites.length === 0) throw new Error("Campo de biomas vazio");
  const { seed, warpFrequency: frequency, warpAmplitude: amplitude, octaves } = spec;

  function warp(x: number, y: number): Coordinate {
    return {
      x: x + (fbm(seed + 101, x * frequency, y * frequency, octaves) - 0.5) * 2 * amplitude,
      y: y + (fbm(seed + 977, x * frequency + 31.7, y * frequency - 12.3, octaves) - 0.5) * 2 * amplitude,
    };
  }

  function nearestBiome(x: number, y: number): BiomeId {
    const warped = warp(x, y);
    let winner = sites[0] as BiomeSite;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const site of sites) {
      const distance = (site.x - warped.x) ** 2 + (site.y - warped.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        winner = site;
      }
    }
    return winner.biome;
  }

  // O gerador reconsulta as mesmas células milhões de vezes ao avaliar
  // posicionamentos. Só células inteiras dentro de CACHE_REACH entram no
  // cache: o traçado de contorno varre coordenadas fracionárias e o campo
  // é infinito, então uma chave por consulta encheria o mapa à toa.
  const cache = new Map<number, BiomeId>();

  return {
    spec,
    sites,
    warp,
    biomeAt(x, y) {
      const key = cacheKey(x, y);
      if (key === undefined) return nearestBiome(x, y);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const biome = nearestBiome(x, y);
      cache.set(key, biome);
      return biome;
    },
  };
}

/**
 * "Quem tem mais espaço ganha": o bioma da palavra é o que ocupa mais
 * células. Empate resolve pela célula central e, se ela não estiver
 * empatada, pela ordem alfabética — só para manter o resultado determinístico.
 */
export function majorityBiome(field: BiomeField, cells: readonly Coordinate[]): BiomeId {
  if (cells.length === 0) throw new Error("Palavra sem células para eleger bioma");

  // Caminho rápido: a maioria esmagadora das palavras cai inteira num bioma só,
  // e aí não vale a pena montar o mapa de contagem.
  const head = cells[0] as Coordinate;
  const first = field.biomeAt(head.x, head.y);
  let uniform = true;
  for (let index = 1; index < cells.length; index += 1) {
    const cell = cells[index] as Coordinate;
    if (field.biomeAt(cell.x, cell.y) !== first) {
      uniform = false;
      break;
    }
  }
  if (uniform) return first;

  const counts = new Map<BiomeId, number>();
  for (const cell of cells) {
    const biome = field.biomeAt(cell.x, cell.y);
    counts.set(biome, (counts.get(biome) ?? 0) + 1);
  }
  let best = 0;
  for (const count of counts.values()) best = Math.max(best, count);
  const tied = [...counts.entries()].filter(([, count]) => count === best).map(([biome]) => biome);
  if (tied.length === 1) return tied[0] as BiomeId;

  const center = cells[Math.floor((cells.length - 1) / 2)] as Coordinate;
  const centerBiome = field.biomeAt(center.x, center.y);
  if (tied.includes(centerBiome)) return centerBiome;
  return [...tied].sort()[0] as BiomeId;
}
