import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { generateMediumMap } from "../generation/medium.js";
import { generateDailyWorld } from "../generation/world.js";
import { coordinateKey, type PlacedWord } from "../generation/types.js";
import { numberWords } from "./numbering.js";

function word(id: string, x: number, y: number, orientation: "horizontal" | "vertical"): PlacedWord {
  return {
    id,
    entryId: id,
    answer: "teste",
    gridAnswer: "TESTE",
    clues: { normal: "n", simple: "s" },
    difficulty: 1,
    familiarity: 1,
    biome: "cotidiano",
    orientation,
    start: { x, y },
  };
}

describe("numeração das palavras", () => {
  it("numera de cima para baixo e da esquerda para a direita", () => {
    const numbers = numberWords([
      word("baixo", 0, 5, "horizontal"),
      word("topo-direita", 9, 0, "horizontal"),
      word("topo-esquerda", 2, 0, "horizontal"),
    ]);
    expect(numbers.get("topo-esquerda")).toBe(1);
    expect(numbers.get("topo-direita")).toBe(2);
    expect(numbers.get("baixo")).toBe(3);
  });

  it("vertical e horizontal que começam na mesma casa dividem o número", () => {
    const numbers = numberWords([
      word("cruzada-h", 4, 4, "horizontal"),
      word("cruzada-v", 4, 4, "vertical"),
      word("outra", 4, 9, "horizontal"),
    ]);
    expect(numbers.get("cruzada-h")).toBe(numbers.get("cruzada-v"));
    expect(numbers.get("outra")).toBe(2);
  });

  it("não depende da ordem em que as palavras chegam", () => {
    const palavras = [
      word("a", 3, 1, "horizontal"),
      word("b", 0, 7, "vertical"),
      word("c", 8, 1, "horizontal"),
    ];
    const direto = numberWords(palavras);
    const invertido = numberWords([...palavras].reverse());
    for (const { id } of palavras) expect(invertido.get(id)).toBe(direto.get(id));
  });

  it("aceita coordenadas negativas, que é o que o mundo real usa", () => {
    const numbers = numberWords([
      word("sul", -3, 2, "horizontal"),
      word("norte", -3, -12, "vertical"),
    ]);
    expect(numbers.get("norte")).toBe(1);
    expect(numbers.get("sul")).toBe(2);
  });

  it("dá número a toda palavra de um mapa real, sem depender do progresso", () => {
    const world = generateDailyWorld({
      date: "2026-08-23",
      catalog: loadBundledCatalog(),
      config: { targetWords: 38, attempts: 3, chunkCount: 14 },
    });
    const map = generateMediumMap(world);
    const numbers = numberWords(map.words);

    expect(numbers.size).toBe(map.words.length);
    for (const palavra of map.words) expect(numbers.get(palavra.id)).toBeGreaterThan(0);

    // Duas palavras só compartilham número se compartilham a casa inicial.
    for (const esquerda of map.words) {
      for (const direita of map.words) {
        if (esquerda.id === direita.id) continue;
        const mesmoNumero = numbers.get(esquerda.id) === numbers.get(direita.id);
        const mesmaCasa = coordinateKey(esquerda.start) === coordinateKey(direita.start);
        expect(mesmoNumero).toBe(mesmaCasa);
      }
    }
  });
});
