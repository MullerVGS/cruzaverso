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
    expect(catalog.findByBiomeLetter("cotidiano", "A").map(({ entry }) => entry.id)).toEqual([
      "cot-acao",
    ]);
    expect(catalog.findByBiomeLetter("ciencia", "A").map(({ entry }) => entry.id)).toEqual([
      "cie-atomo",
    ]);
    expect(catalog.entries[0]?.clueMeta.normal).toEqual({
      text: "Aquilo que se faz para produzir um resultado.",
      style: "definition",
      difficulty: 1,
    });
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

  it("preserva metadados editoriais de pistas autorais", () => {
    const catalog = buildContentCatalog([
      {
        id: "cot-botao",
        answer: "botão",
        biomes: ["cotidiano"],
        difficulty: 2,
        familiarity: 5,
        clues: {
          normal: {
            text: "Fecha a camisa sem usar zíper.",
            style: "association",
            difficulty: 2,
          },
          simple: {
            text: "Peça presa à roupa que atravessa uma casa.",
            style: "definition",
            difficulty: 1,
          },
        },
        provenance: {
          source: "teste-editorial",
          license: "original",
          references: [
            {
              sourceId: "volp",
              title: "VOLP",
              url: "https://www.academia.org.br/nossa-lingua/busca-no-vocabulario",
              license: "consulta",
              role: "orthographic",
            },
          ],
        },
      },
    ]);

    expect(catalog.entries[0]?.clues.normal).toBe("Fecha a camisa sem usar zíper.");
    expect(catalog.entries[0]?.clueMeta.normal.style).toBe("association");
    expect(catalog.entries[0]?.provenance.references[0]?.sourceId).toBe("volp");
  });

  it("recusa pista de jogo de palavras sem a marca de interrogação", () => {
    expect(() =>
      buildContentCatalog([
        {
          id: "cot-botao",
          answer: "botão",
          biomes: ["cotidiano"],
          difficulty: 2,
          familiarity: 5,
          clues: {
            normal: { text: "Fecha a camisa sem pedir licença", style: "wordplay", difficulty: 2 },
            simple: { text: "Peça usada para fechar uma roupa.", style: "definition", difficulty: 1 },
          },
          provenance: { source: "teste", license: "original" },
        },
      ]),
    ).toThrow(/jogo de palavras sem interrogação/i);
  });

  it("recusa a mesma redação nas duas pistas", () => {
    expect(() =>
      buildContentCatalog([
        {
          id: "cot-botao",
          answer: "botão",
          biomes: ["cotidiano"],
          difficulty: 2,
          familiarity: 5,
          clues: {
            normal: "Peça usada para fechar uma roupa.",
            simple: "Peça usada para fechar uma roupa.",
          },
          provenance: { source: "teste", license: "original" },
        },
      ]),
    ).toThrow(/pistas normal e simples repetidas/i);
  });
});
