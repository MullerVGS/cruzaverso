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
  lengths: Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => index + 3).map((length) => [
      length,
      catalog.entries.filter((entry) => entry.gridAnswer.length === length).length,
    ]),
  ),
  clueStyles: Object.fromEntries(
    ["definition", "elliptical", "association", "fill-blank", "wordplay", "trivia"].map(
      (style) => [
        style,
        catalog.entries.filter((entry) => entry.clueMeta.normal.style === style).length,
      ],
    ),
  ),
  references: {
    entriesWithReferences: catalog.entries.filter(
      (entry) => entry.provenance.references.length > 0,
    ).length,
    uniqueSources: new Set(
      catalog.entries.flatMap((entry) =>
        entry.provenance.references.map((reference) => reference.sourceId),
      ),
    ).size,
  },
  provenance: Object.fromEntries(
    provenanceSources.map((source) => [
      source,
      catalog.entries.filter((entry) => entry.provenance.source === source).length,
    ]),
  ),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
