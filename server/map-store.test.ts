import Database from "better-sqlite3";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GENERATOR_VERSION } from "../src/generation/world.js";
import { MapStore, normalizeSeed } from "./map-store.js";

const GENERATION_TEST_TIMEOUT_MS = 20_000;

describe("artefato diário persistido", () => {
  it("migra bancos anteriores às colunas de configuração", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cruzaverso-legacy-"));
    const database = new Database(join(directory, "cruzaverso.sqlite"));
    database.exec(`
      CREATE TABLE daily_artifacts (
        date TEXT PRIMARY KEY,
        world_id TEXT NOT NULL UNIQUE,
        map_id TEXT NOT NULL UNIQUE,
        generator_version TEXT NOT NULL,
        dataset_version TEXT NOT NULL,
        world_json TEXT NOT NULL,
        map_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE free_maps (
        seed TEXT PRIMARY KEY,
        map_id TEXT NOT NULL,
        generator_version TEXT NOT NULL,
        dataset_version TEXT NOT NULL,
        world_json TEXT NOT NULL,
        map_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    database.close();

    const store = new MapStore(directory);
    const interno = store as unknown as {
      database: { prepare(sql: string): { all(): Array<{ name: string }> } };
    };
    const dailyColumns = interno.database
      .prepare("PRAGMA table_info(daily_artifacts)")
      .all()
      .map((column) => column.name);
    const freeColumns = interno.database
      .prepare("PRAGMA table_info(free_maps)")
      .all()
      .map((column) => column.name);

    expect(dailyColumns).toEqual(expect.arrayContaining(["config_version", "resolved_config_json"]));
    expect(freeColumns).toContain("config_version");
    store.close();
  });

  it("republica byte a byte o artefato do gerador corrente", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const primeiro = store.getOrCreateDaily("2026-08-23");
    const segundo = store.getOrCreateDaily("2026-08-23");

    expect(segundo.map.id).toBe(primeiro.map.id);
    expect(JSON.stringify(segundo)).toBe(JSON.stringify(primeiro));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("preserva artefato publicado por um gerador anterior", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreateDaily("2026-08-23");
    expect(original.world.generatorVersion).toBe(GENERATOR_VERSION);

    const interno = store as unknown as { database: { prepare(sql: string): { run(...args: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET generator_version = ? WHERE date = ?")
      .run("0.9.0-antigo", "2026-08-23");

    const relido = store.getOrCreateDaily("2026-08-23");
    expect(JSON.stringify(relido)).toBe(JSON.stringify(original));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("preserva artefato publicado com outro catálogo", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreateDaily("2026-08-23");

    const interno = store as unknown as { database: { prepare(sql: string): { run(...a: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET dataset_version = ? WHERE date = ?")
      .run("curadoria-v0", "2026-08-23");

    const relido = store.getOrCreateDaily("2026-08-23");
    expect(JSON.stringify(relido)).toBe(JSON.stringify(original));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("preserva artefato publicado com outra configuração", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreateDaily("2026-08-23");

    const interno = store as unknown as {
      database: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    };
    interno.database
      .prepare("UPDATE daily_artifacts SET config_version = ? WHERE date = ?")
      .run("0.9.0-antiga", "2026-08-23");

    const relido = store.getOrCreateDaily("2026-08-23");
    expect(JSON.stringify(relido)).toBe(JSON.stringify(original));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("preserva a telemetria quando a versão armazenada fica antiga", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const artefato = store.getOrCreateDaily("2026-08-23");
    store.recordTelemetry({
      runId: "run-1",
      mapId: artefato.map.id,
      event: "run_started",
      elapsedActiveMs: 0,
      payload: {},
    });

    const interno = store as unknown as {
      database: { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown } };
    };
    interno.database
      .prepare("UPDATE daily_artifacts SET generator_version = ? WHERE date = ?")
      .run("0.9.0-antigo", "2026-08-23");
    store.getOrCreateDaily("2026-08-23");

    const total = interno.database.prepare("SELECT count(*) c FROM telemetry_events").get() as { c: number };
    expect(total.c).toBe(1);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("normaliza a seed antes de guardar", () => {
    expect(normalizeSeed("  Nebulosa 42!! ")).toBe("nebulosa-42");
    expect(normalizeSeed("Ilhá dõ Café")).toBe("ilha-do-cafe");
    expect(normalizeSeed("???")).toBe(null);
    expect(normalizeSeed("")).toBe(null);
    expect(normalizeSeed("x".repeat(80))).toHaveLength(40);
  });

  it("guarda e reusa o mapa de uma seed livre", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-free-")));
    expect(store.getFree("nebulosa-42")).toBeNull();

    const criado = store.createFree("nebulosa-42");
    const relido = store.getFree("nebulosa-42");

    expect(relido?.map.id).toBe(criado.map.id);
    expect(criado.map.mode).toBe("free");
    expect(criado.map.objective).toEqual({ kind: "sandbox" });
    // A data é sentinela de propósito: com a data do calendário no id, a mesma
    // seed viraria outro mapa amanhã e o save local do jogador sumiria.
    expect(criado.map.id.startsWith("livre-m2-")).toBe(true);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("não reutiliza mapa livre gravado com outra configuração", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-free-")));
    store.createFree("nebulosa-42");

    const interno = store as unknown as {
      database: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    };
    interno.database
      .prepare("UPDATE free_maps SET config_version = ? WHERE seed = ?")
      .run("0.9.0-antiga", "nebulosa-42");

    expect(store.getFree("nebulosa-42")).toBeNull();
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("o arquivo lista o que existe e nunca uma data futura", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-archive-")));
    store.getOrCreateDaily("2026-08-20");

    expect(store.listDaily(10, "2026-08-19")).toEqual([]);
    const entradas = store.listDaily(10, "2026-08-24");
    expect(entradas).toHaveLength(1);
    expect(entradas[0]?.date).toBe("2026-08-20");
    expect(entradas[0]?.words).toBeGreaterThan(10);
    expect(store.getDaily("2026-08-21")).toBeNull();
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("o arquivo preserva uma edição byte a byte depois de um bump de gerador", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-bump-")));
    const original = store.getOrCreateDaily("2026-08-20");

    const interno = store as unknown as { database: { prepare(sql: string): { run(...a: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET generator_version = ? WHERE date = ?")
      .run("0.9.0-antigo", "2026-08-20");

    expect(store.listDaily(10, "2026-08-24")).toHaveLength(1);
    const relido = store.getDaily("2026-08-20");
    expect(JSON.stringify(relido)).toBe(JSON.stringify(original));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS * 2);
});
