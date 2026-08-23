import { BIOMES } from "../src/content/catalog.js";
import { loadBundledCatalog } from "../src/content/bundled.js";

const catalog = loadBundledCatalog();
const report = {
  valid: true,
  entries: catalog.entries.length,
  biomes: Object.fromEntries(BIOMES.map((biome) => [biome, catalog.byBiome[biome].length])),
  difficulty: Object.fromEntries(
    [1, 2, 3, 4, 5].map((difficulty) => [
      difficulty,
      catalog.entries.filter((entry) => entry.difficulty === difficulty).length,
    ]),
  ),
  provenance: [...new Set(catalog.entries.map((entry) => entry.provenance.source))],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
