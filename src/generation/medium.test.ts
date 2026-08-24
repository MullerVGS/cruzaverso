import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { generateMediumMap, validateMediumMap } from "./medium.js";
import { cellsForWord, coordinateKey } from "./types.js";
import { generateDailyWorld } from "./world.js";

const fastConfig = {
  targetWords: 44,
  attempts: 4,
  chunkCount: 16,
};

const world = generateDailyWorld({
  date: "2026-08-23",
  catalog: loadBundledCatalog(),
  config: fastConfig,
});

describe("extração Medium", () => {
  it("seleciona uma seção conectada e posiciona objetivo físico depois do corte", () => {
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
    expect(validateMediumMap(map)).toEqual([]);
  });
  it("repassa o campo de biomas e versiona o artefato do mapa", () => {
    const map = generateMediumMap(world);
    const outraConfiguracao = generateMediumMap({ ...world, configVersion: "outra-configuracao" });

    expect(map.schemaVersion).toBe(2);
    expect(map.biomeField).toEqual(world.biomeField);
    expect(map.id).toContain("-m2-");
    expect(outraConfiguracao.id).not.toBe(map.id);
  });

  it("não premia seções por quantidade de biomas", () => {
    const source = readFileSync(new URL("./medium.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/biomes\s*\*\s*\d/);
  });

  it("o mapa diário mantém chaves e saída e não tem item no chão", () => {
    const map = generateMediumMap(world);
    expect(map.mode).toBe("daily");
    expect(map.objective).toEqual({ kind: "keys-and-exit", keysRequired: 2, keysAvailable: 3 });
    expect(map.objects.filter((object) => object.type === "key")).toHaveLength(3);
    expect(map.objects.filter((object) => object.type === "exit")).toHaveLength(1);
    expect(map.objects.some((object) => object.type === "coin")).toBe(false);
  });

  it("o mapa livre troca chaves e saída por moedas", () => {
    const map = generateMediumMap(world, { mode: "free" });
    expect(map.mode).toBe("free");
    expect(map.objective).toEqual({ kind: "sandbox" });
    expect(map.objects.every((object) => object.type === "coin")).toBe(true);
    expect(map.objects.length).toBeGreaterThanOrEqual(5);
    expect(map.objects.length).toBeLessThanOrEqual(8);
    expect(map.report.valid).toBe(true);
  });

  it("o mapa livre é determinístico", () => {
    const map = generateMediumMap(world, { mode: "free" });
    const replay = generateMediumMap(world, { mode: "free" });
    expect(replay).toEqual(map);
  });

  it("os dois modos escolhem a mesma seção para a mesma seed", () => {
    const daily = generateMediumMap(world);
    const free = generateMediumMap(world, { mode: "free" });
    expect(free.spawn).toEqual(daily.spawn);
    expect(free.words.map((word) => word.id)).toEqual(daily.words.map((word) => word.id));
    expect(free.id).not.toBe(daily.id);
  });

  it("toda moeda vale o mesmo e cai num caminho", () => {
    const map = generateMediumMap(world, { mode: "free" });
    const cells = new Set(map.words.flatMap((word) => cellsForWord(word).map(coordinateKey)));
    for (const object of map.objects) {
      expect(object.type === "coin" && object.value).toBe(12);
      expect(cells.has(coordinateKey(object.position))).toBe(true);
    }
  });

  it("não publica recorte que perde o corredor entre palavras paralelas", () => {
    const regressionWorld = generateDailyWorld({
      date: "2026-02-09",
      catalog: loadBundledCatalog(),
    });
    const map = generateMediumMap(regressionWorld);

    expect(validateMediumMap(map)).toEqual([]);
    expect(map.report.valid).toBe(true);
  }, 10_000);
});
