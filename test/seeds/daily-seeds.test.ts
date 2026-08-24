import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../../src/content/bundled.js";
import { GAME_BALANCE } from "../../src/config/game.js";
import { generateMediumMap, validateMediumMap } from "../../src/generation/medium.js";
import { coordinateKey } from "../../src/generation/types.js";
import { generateDailyWorld, validateWorld } from "../../src/generation/world.js";

const DATES = Array.from(
  { length: 12 },
  (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`,
);

describe("lote crítico de seeds diárias", () => {
  it.each(DATES)(
    "%s gera mundo e Medium válidos sem corredor linear",
    (date) => {
      const world = generateDailyWorld({ date, catalog: loadBundledCatalog() });
      const map = generateMediumMap(world);
      const objectCoordinates = map.objects.map((object) => coordinateKey(object.position));
      const averageDifficulty =
        map.words.reduce((sum, word) => sum + word.difficulty, 0) / map.words.length;

      expect(validateWorld(world)).toEqual([]);
      expect(world.report.valid).toBe(true);
      expect(world.words).toHaveLength(GAME_BALANCE.world.targetWords);
      expect(validateMediumMap(map)).toEqual([]);
      expect(map.report.valid).toBe(true);
      expect(map.report.cycles).toBeGreaterThan(0);
      expect(map.report.routePlans).toHaveLength(3);
      expect(map.report.routePlans.some((plan) => plan.requiredWords.length < map.words.length)).toBe(true);
      expect(map.words.length).toBeGreaterThanOrEqual(GAME_BALANCE.medium.targetWords.minInclusive);
      expect(map.words.length).toBeLessThan(GAME_BALANCE.medium.targetWords.maxExclusive);
      expect(new Set(map.words.map((word) => word.entryId)).size).toBe(map.words.length);
      expect(new Set(objectCoordinates).size).toBe(objectCoordinates.length);
      expect(averageDifficulty).toBeGreaterThanOrEqual(1);
      expect(averageDifficulty).toBeLessThanOrEqual(4);
    },
    10_000,
  );
});
