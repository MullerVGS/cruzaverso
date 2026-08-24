import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GENERATOR_VERSION } from "../src/generation/world.js";
import { DailyStore } from "./daily-store.js";

const GENERATION_TEST_TIMEOUT_MS = 20_000;

describe("artefato diário persistido", () => {
  it("republica byte a byte o artefato do gerador corrente", async () => {
    const store = new DailyStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const primeiro = store.getOrCreate("2026-08-23");
    const segundo = store.getOrCreate("2026-08-23");

    expect(segundo.map.id).toBe(primeiro.map.id);
    expect(JSON.stringify(segundo)).toBe(JSON.stringify(primeiro));
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("descarta e regera artefato gravado por um gerador anterior", async () => {
    // Sem isto, um bump de gerador serve ao cliente um artefato sem os campos
    // que ele espera — o jogo abre em branco em vez de falhar alto.
    const store = new DailyStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreate("2026-08-23");
    expect(original.world.generatorVersion).toBe(GENERATOR_VERSION);

    const interno = store as unknown as { database: { prepare(sql: string): { run(...args: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET generator_version = ? WHERE date = ?")
      .run("0.9.0-antigo", "2026-08-23");

    expect(store.get("2026-08-23")).toBeNull();

    const regerado = store.getOrCreate("2026-08-23");
    expect(regerado.world.generatorVersion).toBe(GENERATOR_VERSION);
    expect(regerado.map.biomeField).toBeDefined();
    expect(regerado.map.id).toBe(original.map.id);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("descarta e regera artefato gravado com outro catálogo", async () => {
    // Catálogo diferente produz outro quebra-cabeça. Servir o antigo esconderia
    // a curadoria nova; e como o id do mapa agora inclui o dataset, o save do
    // jogador fica órfão em vez de ser aplicado no quebra-cabeça errado.
    const store = new DailyStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const original = store.getOrCreate("2026-08-23");

    const interno = store as unknown as { database: { prepare(sql: string): { run(...a: unknown[]): unknown } } };
    interno.database
      .prepare("UPDATE daily_artifacts SET dataset_version = ? WHERE date = ?")
      .run("curadoria-v0", "2026-08-23");

    expect(store.get("2026-08-23")).toBeNull();

    const regerado = store.getOrCreate("2026-08-23");
    expect(regerado.world.datasetVersion).toBe(original.world.datasetVersion);
    expect(regerado.map.id).toBe(original.map.id);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("preserva a telemetria quando o artefato é regerado", async () => {
    const store = new DailyStore(await mkdtemp(join(tmpdir(), "cruzaverso-store-")));
    const artefato = store.getOrCreate("2026-08-23");
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
    store.getOrCreate("2026-08-23");

    const total = interno.database.prepare("SELECT count(*) c FROM telemetry_events").get() as { c: number };
    expect(total.c).toBe(1);
    store.close();
  }, GENERATION_TEST_TIMEOUT_MS);
});
