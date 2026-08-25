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
  routeTo,
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
    expect(state.credits).toBe(25);
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

  it("a luneta recusa alvo sem rota bloqueada e não cobra", () => {
    const map = fixture();
    const before = { ...createInitialGameState(map), credits: 100 };
    const vazio = { x: map.bounds.minX - 40, y: map.bounds.minY - 40 };
    const after = applyGameAction(map, before, {
      type: "use-item",
      item: "unlock-route",
      position: vazio,
    });
    expect(after.credits).toBe(100);
    expect(after.creditsSpent).toBe(0);
    expect(after.itemsUsed).toBe(0);
    expect(after.lastFeedback?.kind).toBe("unavailable");
  });

  it("a luneta recusa rota que ainda está na névoa", () => {
    const map = fixture();
    const before = { ...createInitialGameState(map), credits: 100 };
    const naNevoa = map.words.find(
      (word) =>
        !availableWords(map, before).some((open) => open.id === word.id) &&
        cellsForWord(word).every((cell) => !isCoordinateRevealed(before, cell)),
    );
    expect(naNevoa, "o mapa precisa ter palavra fora do alcance inicial").toBeDefined();
    const after = applyGameAction(map, before, {
      type: "use-item",
      item: "unlock-route",
      position: cellsForWord(naNevoa!)[0]!,
    });
    expect(after.credits).toBe(100);
    expect(after.lastFeedback?.kind).toBe("unavailable");
  });

  it("a luneta libera uma rota avistada que não toca a trilha", () => {
    const map = fixture();
    // Resolver a primeira palavra abre bastante névoa: é dela que sai a rota
    // avistada mas ainda sem acesso, que é o alvo do item.
    const primeira = availableWords(map, createInitialGameState(map))[0]!;
    const aberto = fillAndSubmit(map, createInitialGameState(map), primeira.id);
    const before = { ...aberto, credits: 100 };

    const avistada = map.words.find(
      (word) =>
        !availableWords(map, before).some((open) => open.id === word.id) &&
        cellsForWord(word).some((cell) => isCoordinateRevealed(before, cell)),
    );
    expect(avistada, "o mapa precisa ter rota avistada e bloqueada").toBeDefined();

    const after = applyGameAction(map, before, {
      type: "use-item",
      item: "unlock-route",
      position: cellsForWord(avistada!)[0]!,
    });

    expect(after.credits).toBe(80);
    expect(after.itemsUsed).toBe(1);
    expect(after.unlockedWordIds).toContain(avistada!.id);
    expect(availableWords(map, after).some((word) => word.id === avistada!.id)).toBe(true);
    // Liberar dá trabalho, não teleporte: andar continua exigindo caminho resolvido.
    const longe = applyGameAction(map, after, {
      type: "move",
      destination: cellsForWord(avistada!)[0]!,
    });
    expect(longe.lastFeedback?.kind).toBe("blocked");
  });

  it("a rota liberada aceita letra e paga crédito ao ser resolvida", () => {
    const map = fixture();
    const primeira = availableWords(map, createInitialGameState(map))[0]!;
    const aberto = fillAndSubmit(map, createInitialGameState(map), primeira.id);
    const before = { ...aberto, credits: 100 };
    const avistada = map.words.find(
      (word) =>
        !availableWords(map, before).some((open) => open.id === word.id) &&
        cellsForWord(word).some((cell) => isCoordinateRevealed(before, cell)),
    )!;

    let state = applyGameAction(map, before, {
      type: "use-item",
      item: "unlock-route",
      position: cellsForWord(avistada)[0]!,
    });
    const saldo = state.credits;
    state = fillAndSubmit(map, state, avistada.id);

    expect(state.solvedWordIds).toContain(avistada.id);
    expect(state.credits).toBe(saldo + avistada.gridAnswer.length);
  });
});

describe("rota do explorador", () => {
  it("devolve as casas do corredor, sem a de origem, e nada quando ele já está lá", () => {
    const map = fixture();
    const primeira = availableWords(map, createInitialGameState(map))[0]!;
    const state = fillAndSubmit(map, createInitialGameState(map), primeira.id);
    const cells = cellsForWord(primeira);
    const destino = cells[cells.length - 1]!;

    const rota = routeTo(map, state, destino);
    expect(rota).not.toBeNull();
    expect(rota!.map(coordinateKey)).not.toContain(coordinateKey(state.player));
    expect(coordinateKey(rota!.at(-1)!)).toBe(coordinateKey(destino));
    // Cada passo é vizinho do anterior: é isso que faz a caminhada seguir o
    // corredor em vez de cortar caminho pela névoa.
    let anterior = state.player;
    for (const passo of rota!) {
      expect(Math.abs(passo.x - anterior.x) + Math.abs(passo.y - anterior.y)).toBe(1);
      anterior = passo;
    }
    expect(routeTo(map, state, state.player)).toEqual([]);
  });

  it("não devolve rota para onde não há caminho em tinta", () => {
    const map = fixture();
    const state = createInitialGameState(map);
    const longe = { x: map.bounds.maxX + 5, y: map.bounds.maxY + 5 };
    expect(routeTo(map, state, longe)).toBeNull();
  });

  it("andar apaga o recado anterior e não mexe em nada quando o destino é a casa atual", () => {
    const map = fixture();
    const primeira = availableWords(map, createInitialGameState(map))[0]!;
    const aberto = fillAndSubmit(map, createInitialGameState(map), primeira.id);
    const bloqueado = applyGameAction(map, aberto, {
      type: "move",
      destination: { x: map.bounds.maxX + 5, y: map.bounds.maxY + 5 },
    });
    expect(bloqueado.lastFeedback?.kind).toBe("blocked");

    const cells = cellsForWord(primeira);
    const andou = applyGameAction(map, bloqueado, { type: "move", destination: cells.at(-1)! });
    expect(andou.lastFeedback).toBeNull();

    // Sem passo não há estado novo: é o que deixa o clique na própria casa
    // livre para virar troca de foco em vez de movimento.
    expect(applyGameAction(map, andou, { type: "move", destination: andou.player })).toBe(andou);
  });
});

describe("fim da expedição livre", () => {
  // Resolver o mapa inteiro deixa toda casa transitável, e é o que permite
  // caminhar até cada moeda sem depender de onde o gerador as espalhou.
  function livreResolvido() {
    const world = generateDailyWorld({
      date: "2026-08-23",
      catalog: loadBundledCatalog(),
      config: { targetWords: 38, attempts: 3, chunkCount: 14 },
    });
    const map = generateMediumMap(world, { mode: "free" });
    let state = createInitialGameState(map);
    for (const word of map.words) state = fillAndSubmit(map, state, word.id);
    return { map, state };
  }

  it("a última moeda recolhida encerra a expedição livre", () => {
    const { map, state } = livreResolvido();
    const coins = map.objects.filter((object) => object.type === "coin");
    expect(coins.length).toBeGreaterThan(1);

    // Um passo pode apanhar mais de uma moeda: o explorador recolhe o que está
    // no trajeto, não só o destino. Por isso a asserção é sobre o que sobrou no
    // chão, e não sobre a ordem da lista.
    const pendentes = (candidate: GameState) =>
      coins.filter((coin) => !candidate.collectedObjectIds.includes(coin.id)).length;

    let next = state;
    for (const coin of coins) {
      if (next.collectedObjectIds.includes(coin.id)) continue;
      next = applyGameAction(map, next, { type: "move", destination: coin.position });
      expect(next.status).toBe(pendentes(next) === 0 ? "won" : "playing");
    }

    expect(pendentes(next)).toBe(0);
    expect(next.status).toBe("won");
    expect(next.finishedAtActiveMs).toBe(next.activeMs);
  });

  it("resolver o mapa inteiro sem recolher moeda não encerra nada", () => {
    const { state } = livreResolvido();
    expect(state.status).toBe("playing");
  });

  it("a expedição diária ignora moedas e continua exigindo chaves e saída", () => {
    const map = fixture();
    expect(map.objective.kind).toBe("keys-and-exit");
    let state = createInitialGameState(map);
    for (const word of map.words) state = fillAndSubmit(map, state, word.id);
    const keys = map.objects.filter((object) => object.type === "key");
    for (const key of keys) {
      state = applyGameAction(map, state, { type: "move", destination: key.position });
    }
    // Com todas as chaves na mão, só a saída encerra.
    expect(state.status).toBe("playing");
  });
});
