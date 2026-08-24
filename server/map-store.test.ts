import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GENERATOR_VERSION } from "../src/generation/world.js";
import { MapStore, normalizeSeed } from "./map-store.js";

const GENERATION_TEST_TIMEOUT_MS = 20_000;

describe("artefato diário persistido", () => {
  it("republica byte a byte o artefato do gerador corrente", async () => {
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const primeiro = store.getOrCreateDaily("2026-08-23");
    const segundo = store.getOrCreateDaily("2026-08-23");

    expect(segundo.map.id).toBe(primeiro.map.id);
    expect(JSON.stringify(segundo)).toBe(JSON.stringify(primeiro));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("descarta e regera artefato gravado por um gerador anterior", async () => {
    // Sem isto, um bump de gerador serve ao cliente um artefato sem os campos
    // que ele espera — o jogo abre em branco em vez de falhar alto.
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreateDaily("2026-08-23");
    expect(original.world.generatorVersion).toBe(GENERATOR_VERSION);

    const interno = store as unknown as { database: { prepare(sql: string): { run(...args: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET generator_version = ? WHERE date = ?")
      .run("0.9.0-antigo", "2026-08-23");

    expect(store.get("2026-08-23")).toBeNull();

    const regerado = store.getOrCreateDaily("2026-08-23");
    expect(regerado.world.generatorVersion).toBe(GENERATOR_VERSION);
    expect(regerado.map.biomeField).toBeDefined();
    expect(regerado.map.id).toBe(original.map.id);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("descarta e regera artefato gravado com outro catálogo", async () => {
    // Catálogo diferente produz outro quebra-cabeça. Servir o antigo esconderia
    // a curadoria nova; e como o id do mapa agora inclui o dataset, o save do
    // jogador fica órfão em vez de ser aplicado no quebra-cabeça errado.
    const store = new MapStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreateDaily("2026-08-23");

    const interno = store as unknown as { database: { prepare(sql: string): { run(...a: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET dataset_version = ? WHERE date = ?")
      .run("curadoria-v0", "2026-08-23");

    expect(store.get("2026-08-23")).toBeNull();

    const regerado = store.getOrCreateDaily("2026-08-23");
    expect(regerado.world.datasetVersion).toBe(original.world.datasetVersion);
    expect(regerado.map.id).toBe(original.map.id);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("preserva a telemetria quando o artefato é regerado", async () => {
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
});
