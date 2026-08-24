import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { generateMediumMap, validateDailyMap } from "./medium.js";
import { generateDailyWorld } from "./world.js";

const fastConfig = {
  targetWords: 44,
  attempts: 4,
  chunkCount: 16,
};

describe("extração Medium", () => {
  it("seleciona uma seção conectada e posiciona objetivo físico depois do corte", () => {
    const world = generateDailyWorld({
      date: "2026-08-23",
      catalog: loadBundledCatalog(),
      config: fastConfig,
    });

    const map = generateMediumMap(world);
    const replay = generateMediumMap(world);

    expect(replay).toEqual(map);
    expect(map.words.length).toBeGreaterThan(10);
    expect(map.words.every((word) => world.words.some((candidate) => candidate.id === word.id))).toBe(
      true,
    );
    expect(map.objects.filter((object) => object.type === "key")).toHaveLength(3);
    expect(map.objects.filter((object) => object.type === "exit")).toHaveLength(1);
    expect(map.objective).toEqual({ kind: "keys-and-exit", keysRequired: 2, keysAvailable: 3 });
    expect(map.report.routePlans).toHaveLength(3);
    expect(map.report.routeDiversity).toBeGreaterThan(0);
    expect(map.report.candidateReports.length).toBeGreaterThan(1);
    expect(map.report.routePlans.some((plan) => plan.requiredWords.length < map.words.length)).toBe(true);
    expect(validateDailyMap(map)).toEqual([]);
  });
  it("repassa o campo de biomas e versiona o artefato do mapa", () => {
    const catalog = loadBundledCatalog();
    const world = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const map = generateMediumMap(world);

    expect(map.schemaVersion).toBe(2);
    expect(map.biomeField).toEqual(world.biomeField);
    expect(map.id).toContain("-m2-");
  });

  it("não premia seções por quantidade de biomas", () => {
    const source = readFileSync(new URL("./medium.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/biomes\s*\*\s*\d/);
  });
});
