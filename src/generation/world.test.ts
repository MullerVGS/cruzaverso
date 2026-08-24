import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { createBiomeField, majorityBiome } from "./biome-field.js";
import { cellsForWord } from "./types.js";
import { generateDailyWorld, validateWorld } from "./world.js";

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
    expect(world.generatorVersion).toBe("2.0.0");
    expect(world.biomeField.seed).toBeTypeOf("number");
    expect(world.biomeField.octaves).toBeGreaterThan(0);
    expect(world.id).toContain("-g2-");
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
