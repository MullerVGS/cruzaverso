import { describe, expect, it } from "vitest";

import { loadBundledCatalog } from "../content/bundled.js";
import { buildContentCatalog } from "../content/catalog.js";
import { createBiomeField, majorityBiome } from "./biome-field.js";
import { cellsForWord, type DailyWorld, type PlacedWord } from "./types.js";
import {
  GENERATOR_CONFIG_VERSION,
  GENERATOR_VERSION,
  generateDailyWorld,
  type WorldGenerationSnapshot,
  validateWorld,
} from "./world.js";

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

  it("observa as etapas sem alterar o mundo gerado", () => {
    const catalog = loadBundledCatalog();
    const baseline = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const snapshots: WorldGenerationSnapshot[] = [];

    const observed = generateDailyWorld({
      date: "2026-08-23",
      catalog,
      config: fastConfig,
      observer(snapshot) {
        snapshots.push(structuredClone(snapshot));
        const mutable = snapshot as unknown as {
          biomeSites: Array<{ x: number }>;
          chunks: unknown[];
          words: unknown[];
        };
        if (mutable.biomeSites[0]) mutable.biomeSites[0].x = 999_999;
        mutable.chunks.length = 0;
        mutable.words.length = 0;
      },
    });

    expect(snapshots.map((snapshot) => snapshot.phase)).toEqual(
      expect.arrayContaining(["biome-field", "chunks", "word-placed", "attempt-complete", "selected"]),
    );
    expect(snapshots.at(-1)?.phase).toBe("selected");
    expect(observed).toEqual(baseline);
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

  it("publica o campo de biomas e a versão nova do artefato", () => {
    const catalog = loadBundledCatalog();
    const world = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });

    expect(world.schemaVersion).toBe(2);
    expect(world.generatorVersion).toBe(GENERATOR_VERSION);
    expect(world.configVersion).toBe(GENERATOR_CONFIG_VERSION);
    expect(world.biomeField.seed).toBeTypeOf("number");
    expect(world.biomeField.octaves).toBeGreaterThan(0);
    expect(world.id).toContain("-g2-");
  });

  it("dá ids diferentes a catálogos diferentes na mesma seed", () => {
    // Sem isto, expandir o dataset produz outro quebra-cabeça com o mesmo id:
    // o save local passa na checagem de `mapId` e escreve nas células erradas.
    const entries = loadBundledCatalog().entries.map((entry) => ({ ...entry }));
    const v1 = buildContentCatalog(entries, "catalogo-v1");
    const v2 = buildContentCatalog(entries, "catalogo-v2");

    const mundoV1 = generateDailyWorld({ date: "2026-08-23", catalog: v1, config: fastConfig });
    const mundoV2 = generateDailyWorld({ date: "2026-08-23", catalog: v2, config: fastConfig });

    expect(mundoV1.datasetVersion).toBe("catalogo-v1");
    expect(mundoV2.datasetVersion).toBe("catalogo-v2");
    expect(mundoV2.id).not.toBe(mundoV1.id);
    // Mesmas entradas: só a etiqueta muda, então as palavras têm que coincidir.
    expect(mundoV2.words.map((word) => word.entryId)).toEqual(mundoV1.words.map((word) => word.entryId));
  });

  it("dá ids diferentes quando o conteúdo muda sem trocar a etiqueta", () => {
    const entries = loadBundledCatalog().entries.map((entry, index) => ({
      ...entry,
      clues:
        index === 0
          ? { ...entry.clues, normal: `${entry.clues.normal} Variante editorial.` }
          : entry.clues,
    }));
    const original = buildContentCatalog(loadBundledCatalog().entries, "mesma-versao");
    const alterado = buildContentCatalog(entries, "mesma-versao");

    const mundoOriginal = generateDailyWorld({
      date: "2026-08-23",
      catalog: original,
      config: fastConfig,
    });
    const mundoAlterado = generateDailyWorld({
      date: "2026-08-23",
      catalog: alterado,
      config: fastConfig,
    });

    expect(alterado.contentFingerprint).not.toBe(original.contentFingerprint);
    expect(mundoAlterado.id).not.toBe(mundoOriginal.id);
    expect(mundoAlterado.words.map((word) => word.entryId)).toEqual(
      mundoOriginal.words.map((word) => word.entryId),
    );
  });

  it("dá ids diferentes a configurações de geração diferentes", () => {
    const catalog = loadBundledCatalog();
    const menor = generateDailyWorld({
      date: "2026-08-23",
      catalog,
      config: { ...fastConfig, targetWords: 24 },
    });
    const maior = generateDailyWorld({
      date: "2026-08-23",
      catalog,
      config: { ...fastConfig, targetWords: 25 },
    });

    expect(maior.id).not.toBe(menor.id);
  });

  it("cataloga cada palavra no bioma onde ela ocupa mais células", () => {
    const catalog = loadBundledCatalog();
    const world = generateDailyWorld({ date: "2026-08-23", catalog, config: fastConfig });
    const field = createBiomeField(world.biomeField, world.biomeSites);

    for (const word of world.words) {
      expect(word.biome).toBe(majorityBiome(field, cellsForWord(word)));
    }
  });

  it("mantém a palavra central no bioma da origem em seeds antes problemáticas", () => {
    const catalog = loadBundledCatalog();
    for (const date of ["2026-01-14", "2026-01-23", "2026-01-26"]) {
      const world = generateDailyWorld({ date, catalog });
      const field = createBiomeField(world.biomeField, world.biomeSites);
      const initial = world.words[0];
      expect(initial?.biome, date).toBe(
        initial ? majorityBiome(field, cellsForWord(initial)) : undefined,
      );
    }
  }, 20_000);

  it("gera mesmo quando o bioma da origem não abriga nenhuma resposta central", () => {
    const catalog = loadBundledCatalog();
    for (const seed of ["cruzaverso:livre:nebulosa-e2e", "cruzaverso:livre:sonda-7"]) {
      const world = generateDailyWorld({ date: "livre", seed, catalog });
      expect(validateWorld(world), seed).toEqual([]);
      const field = createBiomeField(world.biomeField, world.biomeSites);
      const initial = world.words[0];
      expect(initial?.biome, seed).toBe(
        initial ? majorityBiome(field, cellsForWord(initial)) : undefined,
      );
    }
  }, 20_000);

  it("recusa palavras apenas encostadas de lado ou pela ponta", () => {
    const placed = (
      id: string,
      answer: string,
      orientation: PlacedWord["orientation"],
      start: PlacedWord["start"],
    ): PlacedWord => ({
      id,
      entryId: id,
      answer,
      gridAnswer: answer,
      clues: { normal: "Pista principal", simple: "Pista direta" },
      difficulty: 1,
      familiarity: 5,
      biome: "cotidiano",
      orientation,
      start,
    });
    const lateral = {
      words: [
        placed("gato", "GATO", "horizontal", { x: 0, y: 0 }),
        placed("pato", "PATO", "horizontal", { x: 0, y: 1 }),
      ],
    } as DailyWorld;
    const ponta = {
      words: [
        placed("gato", "GATO", "horizontal", { x: 0, y: 0 }),
        placed("pato", "PATO", "horizontal", { x: 4, y: 0 }),
      ],
    } as DailyWorld;

    expect(validateWorld(lateral)).toContain("Palavra gato encosta lateralmente em outra palavra");
    expect(validateWorld(ponta)).toContain("Palavra gato encosta pela ponta em outra palavra");
  });
});
