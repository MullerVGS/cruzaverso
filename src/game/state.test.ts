import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { generateMediumMap } from "../generation/medium.js";
import { generateDailyWorld } from "../generation/world.js";
import { cellsForWord, coordinateKey } from "../generation/types.js";
import {
  applyGameAction,
  availableWords,
  createInitialGameState,
  isCoordinateRevealed,
  type GameState,
} from "./state.js";

function fixture() {
  const world = generateDailyWorld({
    date: "2026-08-23",
    catalog: loadBundledCatalog(),
    config: { targetWords: 38, attempts: 3, chunkCount: 14 },
  });
  return generateMediumMap(world);
}

function fillAndSubmit(map: ReturnType<typeof fixture>, state: GameState, wordId: string) {
  const word = map.words.find((candidate) => candidate.id === wordId);
  if (!word) throw new Error(`Palavra ausente: ${wordId}`);
  let next = state;
  for (const cell of cellsForWord(word)) {
    next = applyGameAction(map, next, { type: "write-cell", position: cell, letter: cell.letter });
  }
  return applyGameAction(map, next, { type: "submit-word", wordId });
}

describe("estado de uma run", () => {
  it("confere automaticamente quando a palavra inteira fica preenchida", () => {
    const map = fixture();
    const word = availableWords(map, createInitialGameState(map))[0]!;
    let state = createInitialGameState(map);
    for (const cell of cellsForWord(word)) {
      state = applyGameAction(map, state, {
        type: "write-cell",
        position: cell,
        letter: cell.letter,
      });
    }
    expect(state.solvedWordIds).toContain(word.id);
    expect(state.lastFeedback?.kind).toBe("correct");
  });

  it("mantém uma tentativa errada a lápis e trava a resposta certa em tinta", () => {
    const map = fixture();
    const first = availableWords(map, createInitialGameState(map))[0];
    expect(first).toBeDefined();
    const firstCell = cellsForWord(first!)[0]!;
    let state = createInitialGameState(map);

    state = applyGameAction(map, state, {
      type: "write-cell",
      position: firstCell,
      letter: firstCell.letter === "A" ? "B" : "A",
    });
    state = applyGameAction(map, state, { type: "submit-word", wordId: first!.id });

    expect(state.solvedWordIds).not.toContain(first!.id);
    expect(state.pencil[coordinateKey(firstCell)]).toBeTruthy();
    expect(state.lastFeedback?.kind).toBe("incorrect");

    state = fillAndSubmit(map, state, first!.id);
    expect(state.solvedWordIds).toContain(first!.id);
    expect(state.ink[coordinateKey(firstCell)]).toBe(firstCell.letter);
    expect(state.firstSolveRevealGranted).toBe(true);
    expect(isCoordinateRevealed(state, { x: map.spawn.x + 8, y: map.spawn.y })).toBe(true);
  });

  it("permite resolver a rede, mover instantaneamente e cumprir o objetivo sem derrota", () => {
    const map = fixture();
    let state = createInitialGameState(map);

    while (state.solvedWordIds.length < map.words.length) {
      const next = availableWords(map, state).find(
        (word) => !state.solvedWordIds.includes(word.id),
      );
      expect(next, "a fronteira deve alcançar todo o mapa").toBeDefined();
      state = fillAndSubmit(map, state, next!.id);
    }
    expect(state.capturedCellKeys.length).toBeGreaterThan(0);

    const keys = map.objects.filter((object) => object.type === "key");
    const exit = map.objects.find((object) => object.type === "exit");
    expect(exit).toBeDefined();
    for (const key of keys.slice(0, 2)) {
      state = applyGameAction(map, state, { type: "move", destination: key.position });
    }
    expect(state.keysCollected).toBeGreaterThanOrEqual(2);
    expect(state.status).toBe("playing");

    state = applyGameAction(map, state, { type: "move", destination: exit!.position });
    expect(state.status).toBe("won");
    expect(state.finishedAtActiveMs).not.toBeNull();
  });

  it("começa com o estipêndio inicial na carteira", () => {
    const state = createInitialGameState(fixture());
    expect(state.credits).toBe(15);
    expect(state.creditsSpent).toBe(0);
  });

  it("paga um crédito por letra ao resolver a palavra", () => {
    const map = fixture();
    const word = availableWords(map, createInitialGameState(map))[0]!;
    const before = createInitialGameState(map);
    const after = fillAndSubmit(map, before, word.id);
    expect(after.credits).toBe(before.credits + word.gridAnswer.length);
    expect(after.creditsEarned).toBe(before.creditsEarned + word.gridAnswer.length);
  });

  it("recusa o item sem saldo e não cobra nada", () => {
    const map = fixture();
    const word = availableWords(map, createInitialGameState(map))[0]!;
    const poor = { ...createInitialGameState(map), credits: 3 };
    const after = applyGameAction(map, poor, {
      type: "use-item",
      item: "simplify-clue",
      wordId: word.id,
    });
    expect(after).toBe(poor);
  });

  it("cobra o item, revela a letra e marca a casa como comprada", () => {
    const map = fixture();
    const word = availableWords(map, createInitialGameState(map))[0]!;
    const cell = cellsForWord(word)[0]!;
    const before = { ...createInitialGameState(map), credits: 100 };
    const after = applyGameAction(map, before, {
      type: "use-item",
      item: "reveal-letter",
      position: cell,
    });
    expect(after.credits).toBe(90);
    expect(after.creditsSpent).toBe(10);
    expect(after.itemsUsed).toBe(1);
    expect(after.ink[coordinateKey(cell)]).toBe(cell.letter);
    expect(after.hintedCellKeys).toContain(coordinateKey(cell));
  });

  it("a segunda pista não apaga a primeira", () => {
    const map = fixture();
    const word = availableWords(map, createInitialGameState(map))[0]!;
    const before = { ...createInitialGameState(map), credits: 100 };
    const after = applyGameAction(map, before, {
      type: "use-item",
      item: "simplify-clue",
      wordId: word.id,
    });
    expect(after.simplifiedWordIds).toContain(word.id);
    expect(map.words.find((candidate) => candidate.id === word.id)?.clues.normal).toBeTruthy();
  });

  it("a luneta abre a área no ponto escolhido, não no explorador", () => {
    const map = fixture();
    const target = { x: map.spawn.x + 14, y: map.spawn.y + 14 };
    const before = { ...createInitialGameState(map), credits: 100 };
    const after = applyGameAction(map, before, {
      type: "use-item",
      item: "reveal-area",
      position: target,
    });
    expect(isCoordinateRevealed(after, target)).toBe(true);
  });
});
