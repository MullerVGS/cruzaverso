import { describe, expect, it } from "vitest";

import { BIOMES } from "./catalog.js";
import { loadBundledCatalog } from "./bundled.js";

describe("dataset PT-BR embarcado", () => {
  it("publica conteúdo válido, único e utilizável em todos os biomas", () => {
    const catalog = loadBundledCatalog();

    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(new Set(catalog.entries.map((entry) => entry.gridAnswer)).size).toBe(
      catalog.entries.length,
    );
    for (const biome of BIOMES) {
      expect(catalog.byBiome[biome].length, biome).toBeGreaterThan(0);
    }
  });
});
