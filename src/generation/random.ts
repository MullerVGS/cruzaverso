function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class SeededRandom {
  readonly seed: string;
  private state: number;

  constructor(seed: string) {
    this.seed = seed;
    this.state = hashString(seed) || 0x6d2b79f5;
  }

  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      throw new Error("Intervalo aleatório inválido");
    }
    return minInclusive + Math.floor(this.float() * (maxExclusive - minInclusive));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length)];
    if (item === undefined) {
      throw new Error("Não é possível sortear de uma lista vazia");
    }
    return item;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index + 1);
      [shuffled[index], shuffled[other]] = [shuffled[other] as T, shuffled[index] as T];
    }
    return shuffled;
  }

  fork(label: string): SeededRandom {
    return new SeededRandom(`${this.seed}:${label}`);
  }
}

export function seedFingerprint(seed: string): string {
  return hashString(seed).toString(16).padStart(8, "0");
}
