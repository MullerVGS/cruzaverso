import { describe, expect, it } from "vitest";

import { BIOMES } from "./catalog.js";
import { loadBundledCatalog } from "./bundled.js";

describe("dataset PT-BR embarcado", () => {
  it("publica conteúdo válido, único e utilizável em todos os biomas", () => {
    const catalog = loadBundledCatalog();

    expect(catalog.entries).toHaveLength(1_500);
    expect(new Set(catalog.entries.map((entry) => entry.gridAnswer)).size).toBe(
      catalog.entries.length,
    );
    for (const biome of BIOMES) {
      expect(catalog.byBiome[biome], biome).toHaveLength(250);
    }
    expect(catalog.entries.every((entry) => entry.provenance.references.length > 0)).toBe(true);
    expect(new Set(catalog.entries.map((entry) => entry.clues.normal)).size).toBe(1_500);
    expect(new Set(catalog.entries.map((entry) => entry.clues.simple)).size).toBe(1_500);
  });
});
