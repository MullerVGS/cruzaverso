import { describe, expect, it } from "vitest";

import { crosswordDensity } from "./density.js";
import type { PlacedWord } from "./types.js";

function word(
  id: string,
  gridAnswer: string,
  orientation: PlacedWord["orientation"],
  start: PlacedWord["start"],
): PlacedWord {
  return {
    id,
    entryId: id,
    answer: gridAnswer,
    gridAnswer,
    clues: { normal: "Pista principal.", simple: "Pista direta." },
    difficulty: 1,
    familiarity: 5,
    biome: "cotidiano",
    orientation,
    start,
  };
}

describe("métricas de densidade da crossword", () => {
  it("conta célula compartilhada e letras cruzadas por resposta", () => {
    const density = crosswordDensity([
      word("horizontal", "CASA", "horizontal", { x: 0, y: 1 }),
      word("vertical", "ASA", "vertical", { x: 1, y: 0 }),
    ]);

    expect(density).toEqual({
      letterOccurrences: 7,
      uniqueCells: 6,
      crossings: 1,
      checkedCellRatio: 1 / 6,
      crossedLettersPerWord: 1,
    });
  });
});
