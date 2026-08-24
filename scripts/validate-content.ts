import { BIOMES } from "../src/content/catalog.js";
import { loadBundledCatalog } from "../src/content/bundled.js";

const catalog = loadBundledCatalog();
const provenanceSources = [...new Set(catalog.entries.map((entry) => entry.provenance.source))];
const report = {
  valid: true,
  datasetVersion: catalog.datasetVersion,
  entries: catalog.entries.length,
  biomes: Object.fromEntries(BIOMES.map((biome) => [biome, catalog.byBiome[biome].length])),
  difficulty: Object.fromEntries(
    [1, 2, 3, 4, 5].map((difficulty) => [
      difficulty,
      catalog.entries.filter((entry) => entry.difficulty === difficulty).length,
    ]),
  ),
  provenance: Object.fromEntries(
    provenanceSources.map((source) => [
      source,
      catalog.entries.filter((entry) => entry.provenance.source === source).length,
    ]),
  ),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
