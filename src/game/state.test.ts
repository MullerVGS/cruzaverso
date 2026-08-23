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
    expect(state.finishedAt).toBeTruthy();
  });

  it("aplica os quatro powerups por dados sem criar progressão permanente", () => {
    const map = fixture();
    const word = availableWords(map, createInitialGameState(map))[0]!;
    let state: GameState = {
      ...createInitialGameState(map),
      inventory: {
        "reveal-letter": 1,
        "simplify-clue": 1,
        "reveal-area": 1,
        "objective-direction": 1,
      },
    };

    state = applyGameAction(map, state, {
      type: "use-powerup",
      powerupType: "reveal-letter",
      wordId: word.id,
    });
    expect(Object.keys(state.pencil)).toHaveLength(1);
    state = applyGameAction(map, state, {
      type: "use-powerup",
      powerupType: "simplify-clue",
      wordId: word.id,
    });
    expect(state.simplifiedWordIds).toContain(word.id);
    const previousZones = state.revealZones.length;
    state = applyGameAction(map, state, { type: "use-powerup", powerupType: "reveal-area" });
    expect(state.revealZones.length).toBe(previousZones + 1);
    state = applyGameAction(map, state, {
      type: "use-powerup",
      powerupType: "objective-direction",
    });
    expect(state.directionUsesRemaining).toBeGreaterThan(0);
    expect(Object.values(state.inventory)).toEqual([0, 0, 0, 0]);
  });
});
