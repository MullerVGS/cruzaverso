import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { loadBundledCatalog } from "../src/content/bundled.js";
import { GAME_BALANCE } from "../src/config/game.js";
import { generateMediumMap } from "../src/generation/medium.js";
import type { DailyMap, DailyWorld } from "../src/generation/types.js";
import { GENERATOR_VERSION, generateDailyWorld } from "../src/generation/world.js";

export interface ArchiveEntry {
  date: string;
  mapId: string;
  words: number;
}

/** A data do artefato livre é sentinela: o id não pode mudar com o calendário. */
export const FREE_MAP_DATE = "livre";

export function normalizeSeed(input: string): string | null {
  const slug = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : null;
}

export interface DailyArtifact {
  world: DailyWorld;
  map: DailyMap;
}

interface ArtifactRow {
  world_json: string;
  map_json: string;
}

export interface TelemetryEvent {
  runId: string;
  mapId: string;
  event: string;
  elapsedActiveMs: number;
  payload: Record<string, string | number | boolean | null | undefined>;
}

export class MapStore {
  readonly databasePath: string;
  private readonly database: Database.Database;
  /** Versão do catálogo embarcado nesta build; ver `get`. */
  private readonly datasetVersion: string;

  constructor(dataDirectory: string) {
    this.datasetVersion = loadBundledCatalog().datasetVersion;
    mkdirSync(dataDirectory, { recursive: true });
    this.databasePath = join(dataDirectory, "cruzaverso.sqlite");
    this.database = new Database(this.databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS daily_artifacts (
        date TEXT PRIMARY KEY,
        world_id TEXT NOT NULL UNIQUE,
        map_id TEXT NOT NULL UNIQUE,
        generator_version TEXT NOT NULL,
        dataset_version TEXT NOT NULL,
        config_version TEXT NOT NULL,
        resolved_config_json TEXT NOT NULL,
        world_json TEXT NOT NULL,
        map_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        map_id TEXT NOT NULL,
        event TEXT NOT NULL,
        elapsed_active_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS telemetry_map_event
        ON telemetry_events (map_id, event);
      CREATE TABLE IF NOT EXISTS free_maps (
        seed TEXT PRIMARY KEY,
        map_id TEXT NOT NULL,
        generator_version TEXT NOT NULL,
        dataset_version TEXT NOT NULL,
        config_version TEXT NOT NULL,
        world_json TEXT NOT NULL,
        map_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  get(date: string): DailyArtifact | null {
    const row = this.database
      .prepare(
        "SELECT world_json, map_json, generator_version, dataset_version FROM daily_artifacts WHERE date = ?",
      )
      .get(date) as (ArtifactRow & { generator_version: string; dataset_version: string }) | undefined;
    if (!row) return null;
    // Artefato de um gerador anterior não é servível: o cliente atual espera
    // campos que ele não tem. A regra do projeto é que mudança de algoritmo
    // exige incremento de versão — é esse incremento que autoriza reger.
    // O dataset conta pelo mesmo motivo: catálogo diferente é outro
    // quebra-cabeça, e servir o antigo esconderia a curadoria nova.
    if (row.generator_version !== GENERATOR_VERSION) return null;
    if (row.dataset_version !== this.datasetVersion) return null;
    return {
      world: JSON.parse(row.world_json) as DailyWorld,
      map: JSON.parse(row.map_json) as DailyMap,
    };
  }

  getOrCreateDaily(date: string): DailyArtifact {
    const existing = this.get(date);
    if (existing) return existing;

    const world = generateDailyWorld({ date, catalog: loadBundledCatalog() });
    const map = generateMediumMap(world);
    if (!world.report.valid || !map.report.valid) {
      throw new Error(`Artefato diário inválido para ${date}`);
    }
    this.database
      .prepare(
        `INSERT OR REPLACE INTO daily_artifacts
          (date, world_id, map_id, generator_version, dataset_version, config_version,
           resolved_config_json, world_json, map_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        date,
        world.id,
        map.id,
        world.generatorVersion,
        world.datasetVersion,
        world.configVersion,
        JSON.stringify(GAME_BALANCE),
        JSON.stringify(world),
        JSON.stringify(map),
      );
    return this.get(date) ?? { world, map };
  }

  getDaily(date: string): DailyArtifact | null {
    return this.get(date);
  }

  listDaily(limit: number, today: string): ArchiveEntry[] {
    const rows = this.database
      .prepare(
        `SELECT date, map_id, map_json FROM daily_artifacts
         WHERE date <= ? AND generator_version = ? AND dataset_version = ?
         ORDER BY date DESC LIMIT ?`,
      )
      .all(today, GENERATOR_VERSION, this.datasetVersion, limit) as Array<{
      date: string;
      map_id: string;
      map_json: string;
    }>;
    return rows.map((row) => ({
      date: row.date,
      mapId: row.map_id,
      words: (JSON.parse(row.map_json) as DailyMap).words.length,
    }));
  }

  getFree(seed: string): DailyArtifact | null {
    const row = this.database
      .prepare(
        `SELECT world_json, map_json FROM free_maps
         WHERE seed = ? AND generator_version = ? AND dataset_version = ?`,
      )
      .get(seed, GENERATOR_VERSION, this.datasetVersion) as ArtifactRow | undefined;
    if (!row) return null;
    return {
      world: JSON.parse(row.world_json) as DailyWorld,
      map: JSON.parse(row.map_json) as DailyMap,
    };
  }

  createFree(seed: string): DailyArtifact {
    const world = generateDailyWorld({
      date: FREE_MAP_DATE,
      seed: `cruzaverso:livre:${seed}`,
      catalog: loadBundledCatalog(),
    });
    const map = generateMediumMap(world, { mode: "free" });
    if (!world.report.valid || !map.report.valid) {
      throw new Error(`Mundo livre inválido para a seed ${seed}`);
    }
    this.database
      .prepare(
        `INSERT OR REPLACE INTO free_maps
          (seed, map_id, generator_version, dataset_version, config_version, world_json, map_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seed,
        map.id,
        world.generatorVersion,
        world.datasetVersion,
        world.configVersion,
        JSON.stringify(world),
        JSON.stringify(map),
      );
    return { world, map };
  }

  recordTelemetry(event: TelemetryEvent): void {
    this.database
      .prepare(
        `INSERT INTO telemetry_events
          (run_id, map_id, event, elapsed_active_ms, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.runId,
        event.mapId,
        event.event,
        event.elapsedActiveMs,
        JSON.stringify(event.payload),
      );
  }

  close(): void {
    this.database.close();
  }
}
