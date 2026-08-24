import { DateTime } from "luxon";

import { loadBundledCatalog } from "../src/content/bundled.js";
import { GAME_BALANCE } from "../src/config/game.js";
import { generateMediumMap, validateDailyMap } from "../src/generation/medium.js";
import { generateDailyWorld, validateWorld } from "../src/generation/world.js";

const startDateArgument = process.argv[2] ?? "2026-01-01";
const daysArgument = process.argv[3] ?? "48";
const startDate = DateTime.fromISO(startDateArgument, { zone: "utc" });
const days = Number(daysArgument);

if (!startDate.isValid || startDate.toISODate() !== startDateArgument) {
  throw new Error(`Data inicial inválida: ${startDateArgument}. Use YYYY-MM-DD.`);
}
if (!Number.isInteger(days) || days <= 0) {
  throw new Error(`Quantidade de dias inválida: ${daysArgument}. Use um inteiro positivo.`);
}

function summarize(values: readonly number[]): { min: number; max: number; average: number } {
  const round = (value: number): number => Number(value.toFixed(2));
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function increment(counts: Map<string, number>, entryIds: readonly string[]): void {
  for (const entryId of entryIds) counts.set(entryId, (counts.get(entryId) ?? 0) + 1);
}

const catalog = loadBundledCatalog();
const dates = Array.from({ length: days }, (_, index) =>
  startDate.plus({ days: index }).toISODate(),
).filter((date): date is string => date !== null);
const worldUsage = new Map(catalog.entries.map((entry) => [entry.id, 0]));
const mediumUsage = new Map(catalog.entries.map((entry) => [entry.id, 0]));
const invalid: Array<{ date: string; errors: string[] }> = [];
const shortWorlds: string[] = [];
const outOfRangeMaps: Array<{ date: string; words: number }> = [];
const worldWordCounts: number[] = [];
const mapWordCounts: number[] = [];
const crossings: number[] = [];
const cycles: number[] = [];
const biomes: number[] = [];
const averageDifficulties: number[] = [];

for (const date of dates) {
  const world = generateDailyWorld({ date, catalog });
  const map = generateMediumMap(world);
  const errors = [...validateWorld(world), ...validateDailyMap(map)];

  if (errors.length > 0) invalid.push({ date, errors });
  if (world.words.length < GAME_BALANCE.world.targetWords) shortWorlds.push(date);
  if (
    map.words.length < GAME_BALANCE.medium.targetWords.minInclusive ||
    map.words.length >= GAME_BALANCE.medium.targetWords.maxExclusive
  ) {
    outOfRangeMaps.push({ date, words: map.words.length });
  }

  increment(worldUsage, world.words.map((word) => word.entryId));
  increment(mediumUsage, map.words.map((word) => word.entryId));
  worldWordCounts.push(world.words.length);
  mapWordCounts.push(map.words.length);
  crossings.push(map.report.crossings);
  cycles.push(map.report.cycles);
  biomes.push(map.report.biomes);
  averageDifficulties.push(
    map.words.reduce((sum, word) => sum + word.difficulty, 0) / map.words.length,
  );
}

const unused = (counts: ReadonlyMap<string, number>): string[] =>
  catalog.entries.filter((entry) => counts.get(entry.id) === 0).map((entry) => entry.answer);
const leastUsedMedium = catalog.entries
  .map((entry) => ({ answer: entry.answer, appearances: mediumUsage.get(entry.id) ?? 0 }))
  .sort((left, right) => left.appearances - right.appearances || left.answer.localeCompare(right.answer, "pt-BR"))
  .slice(0, 10);
const coverageByProvenance = Object.fromEntries(
  [...new Set(catalog.entries.map((entry) => entry.provenance.source))].map((source) => {
    const entries = catalog.entries.filter((entry) => entry.provenance.source === source);
    const appearances = entries.map((entry) => mediumUsage.get(entry.id) ?? 0);
    return [
      source,
      {
        entries: entries.length,
        usedMedium: appearances.filter((count) => count > 0).length,
        unusedMedium: entries
          .filter((entry) => mediumUsage.get(entry.id) === 0)
          .map((entry) => entry.answer),
        appearances: summarize(appearances),
      },
    ];
  }),
);

const report = {
  startDate: dates[0],
  endDate: dates.at(-1),
  days,
  datasetVersion: catalog.datasetVersion,
  entries: catalog.entries.length,
  failures: {
    invalid,
    shortWorlds,
    outOfRangeMaps,
  },
  statistics: {
    worldWords: summarize(worldWordCounts),
    mapWords: summarize(mapWordCounts),
    crossings: summarize(crossings),
    cycles: summarize(cycles),
    biomes: summarize(biomes),
    averageDifficulty: summarize(averageDifficulties),
  },
  coverage: {
    world: { used: catalog.entries.length - unused(worldUsage).length, unused: unused(worldUsage) },
    medium: { used: catalog.entries.length - unused(mediumUsage).length, unused: unused(mediumUsage) },
    byProvenance: coverageByProvenance,
    leastUsedMedium,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const requiresCompleteCoverage = days >= 365;
if (
  invalid.length > 0 ||
  shortWorlds.length > 0 ||
  outOfRangeMaps.length > 0 ||
  (requiresCompleteCoverage && (unused(worldUsage).length > 0 || unused(mediumUsage).length > 0))
) {
  process.exitCode = 1;
}
