import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { generateMediumMap, validateDailyMap } from "./medium.js";
import { generateDailyWorld } from "./world.js";

describe("extração Medium", () => {
  it("seleciona uma seção conectada e posiciona objetivo físico depois do corte", () => {
    const world = generateDailyWorld({
      date: "2026-08-23",
      catalog: loadBundledCatalog(),
      config: { targetWords: 44, attempts: 4, chunkCount: 16 },
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
    expect(map.objective).toEqual({ keysRequired: 2, keysAvailable: 3 });
    expect(validateDailyMap(map)).toEqual([]);
  });
});
