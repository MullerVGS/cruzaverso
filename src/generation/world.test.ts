import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { buildContentCatalog } from "../content/catalog.js";
import { createBiomeField, majorityBiome } from "./biome-field.js";
import { cellsForWord } from "./types.js";
import { GENERATOR_VERSION, generateDailyWorld, validateWorld } from "./world.js";

const fastConfig = {
  targetWords: 26,
  attempts: 3,
  chunkCount: 12,
};

describe("mundo diário", () => {
  it("é determinístico e publica somente uma crossword global válida", () => {
    const catalog = loadBundledCatalog();
    const first = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const replay = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });

    expect(replay).toEqual(first);
    expect(first.words.length).toBeGreaterThan(16);
    expect(validateWorld(first)).toEqual([]);
    expect(new Set(first.words.map((word) => word.entryId)).size).toBe(first.words.length);
    expect(first.report.valid).toBe(true);
  });

  it("separa edições de datas diferentes", () => {
    const catalog = loadBundledCatalog();
    const today = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const tomorrow = generateDailyWorld({ date: "2026-08-24", catalog, config: fastConfig });

    expect(tomorrow.id).not.toBe(today.id);
    expect(tomorrow.seed).not.toBe(today.seed);
    expect(tomorrow.words.map((word) => word.entryId)).not.toEqual(
      today.words.map((word) => word.entryId),
    );
  });

  it("publica o campo de biomas e a versão nova do artefato", () => {
    const catalog = loadBundledCatalog();
    const world = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });

    expect(world.schemaVersion).toBe(2);
    expect(world.generatorVersion).toBe(GENERATOR_VERSION);
    expect(world.biomeField.seed).toBeTypeOf("number");
    expect(world.biomeField.octaves).toBeGreaterThan(0);
    expect(world.id).toContain("-g2-");
  });

  it("dá ids diferentes a catálogos diferentes na mesma seed", () => {
    // Sem isto, expandir o dataset produz outro quebra-cabeça com o mesmo id:
    // o save local passa na checagem de `mapId` e escreve nas células erradas.
    const entries = loadBundledCatalog().entries.map((entry) => ({ ...entry }));
    const v1 = buildContentCatalog(entries, "catalogo-v1");
    const v2 = buildContentCatalog(entries, "catalogo-v2");

    const mundoV1 = generateDailyWorld({ date: "2026-08-23", catalog: v1, config: fastConfig });
    const mundoV2 = generateDailyWorld({ date: "2026-08-23", catalog: v2, config: fastConfig });

    expect(mundoV1.datasetVersion).toBe("catalogo-v1");
    expect(mundoV2.datasetVersion).toBe("catalogo-v2");
    expect(mundoV2.id).not.toBe(mundoV1.id);
    // Mesmas entradas: só a etiqueta muda, então as palavras têm que coincidir.
    expect(mundoV2.words.map((word) => word.entryId)).toEqual(mundoV1.words.map((word) => word.entryId));
  });

  it("cataloga cada palavra no bioma onde ela ocupa mais células", () => {
    const catalog = loadBundledCatalog();
    const world = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const field = createBiomeField(world.biomeField, world.biomeSites);

    for (const word of world.words) {
      expect(word.biome).toBe(majorityBiome(field, cellsForWord(word)));
    }
  });
});
