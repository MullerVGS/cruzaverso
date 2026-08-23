import { describe, expect, it } from "vitest";

import { buildContentCatalog, normalizeGridAnswer } from "./catalog.js";

describe("catálogo de conteúdo", () => {
  it("normaliza a grafia PT-BR e indexa cruzamentos por letra e posição", () => {
    const catalog = buildContentCatalog([
      {
        id: "cot-acao",
        answer: "ação",
        biomes: ["cotidiano"],
        difficulty: 1,
        familiarity: 5,
        clues: {
          normal: "Aquilo que se faz para produzir um resultado.",
          simple: "Ato de fazer alguma coisa.",
        },
        provenance: { source: "curadoria-cruzaverso", license: "original" },
      },
      {
        id: "cie-atomo",
        answer: "átomo",
        biomes: ["ciencia"],
        difficulty: 2,
        familiarity: 5,
        clues: {
          normal: "Unidade básica de um elemento químico.",
          simple: "Partícula que forma os elementos químicos.",
        },
        provenance: { source: "curadoria-cruzaverso", license: "original" },
      },
    ]);

    expect(normalizeGridAnswer("ação-reação")).toBe("ACAOREACAO");
    expect(catalog.entries.map((entry) => entry.gridAnswer)).toEqual(["ACAO", "ATOMO"]);
    expect(catalog.findCrossings("A", 0).map((entry) => entry.id)).toEqual([
      "cot-acao",
      "cie-atomo",
    ]);
    expect(catalog.byBiome.cotidiano).toHaveLength(1);
    expect(catalog.byBiome.ciencia).toHaveLength(1);
  });

  it("recusa respostas duplicadas depois da normalização", () => {
    expect(() =>
      buildContentCatalog([
        {
          id: "primeira",
          answer: "ação",
          biomes: ["cotidiano"],
          difficulty: 1,
          familiarity: 5,
          clues: { normal: "Uma clue.", simple: "Clue simples." },
          provenance: { source: "teste", license: "original" },
        },
        {
          id: "segunda",
          answer: "acao",
          biomes: ["historia"],
          difficulty: 1,
          familiarity: 5,
          clues: { normal: "Outra clue.", simple: "Outra simples." },
          provenance: { source: "teste", license: "original" },
        },
      ]),
    ).toThrow(/resposta duplicada.*ACAO/i);
  });
});
