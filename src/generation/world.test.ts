import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { generateDailyWorld, validateWorld } from "./world.js";

const fastConfig = {
  targetWords: 26,
  attempts: 3,
  chunkCount: 12,
};

describe("mundo diário", () => {
  it("é determinístico e publica somente uma crossword global válida", () => {
    const catalog = loadBundledCatalog();
    const first = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const replay = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });

    expect(replay).toEqual(first);
    expect(first.words.length).toBeGreaterThan(16);
    expect(validateWorld(first)).toEqual([]);
    expect(new Set(first.words.map((word) => word.entryId)).size).toBe(first.words.length);
    expect(first.report.valid).toBe(true);
  });

  it("separa edições de datas diferentes", () => {
    const catalog = loadBundledCatalog();
    const today = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const tomorrow = generateDailyWorld({ date: "2026-08-24", catalog, config: fastConfig });

    expect(tomorrow.id).not.toBe(today.id);
    expect(tomorrow.seed).not.toBe(today.seed);
    expect(tomorrow.words.map((word) => word.entryId)).not.toEqual(
      today.words.map((word) => word.entryId),
    );
  });
});
