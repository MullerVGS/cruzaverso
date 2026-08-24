import { cellsForWord, coordinateKey, type PlacedWord } from "./types.js";

export interface CrosswordDensity {
  letterOccurrences: number;
  uniqueCells: number;
  crossings: number;
  checkedCellRatio: number;
  crossedLettersPerWord: number;
}

export function crosswordDensity(words: readonly PlacedWord[]): CrosswordDensity {
  const occupancy = new Map<string, number>();
  let letterOccurrences = 0;
  for (const word of words) {
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
      letterOccurrences += 1;
    }
  }
  const crossings = [...occupancy.values()].filter((count) => count > 1).length;
  const uniqueCells = occupancy.size;
  return {
    letterOccurrences,
    uniqueCells,
    crossings,
    checkedCellRatio: uniqueCells === 0 ? 0 : crossings / uniqueCells,
    crossedLettersPerWord: words.length === 0 ? 0 : (crossings * 2) / words.length,
  };
}
