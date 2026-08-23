import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { loadBundledCatalog } from "../src/content/bundled.js";
import { generateMediumMap } from "../src/generation/medium.js";
import type { DailyMap, DailyWorld } from "../src/generation/types.js";
import { generateDailyWorld } from "../src/generation/world.js";

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

export class DailyStore {
  readonly databasePath: string;
  private readonly database: Database.Database;

  constructor(dataDirectory: string) {
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
    `);
  }

  get(date: string): DailyArtifact | null {
    const row = this.database
      .prepare("SELECT world_json, map_json FROM daily_artifacts WHERE date = ?")
      .get(date) as ArtifactRow | undefined;
    if (!row) return null;
    return {
      world: JSON.parse(row.world_json) as DailyWorld,
      map: JSON.parse(row.map_json) as DailyMap,
    };
  }

  getOrCreate(date: string): DailyArtifact {
    const existing = this.get(date);
    if (existing) return existing;

    const world = generateDailyWorld({ date, catalog: loadBundledCatalog() });
    const map = generateMediumMap(world);
    if (!world.report.valid || !map.report.valid) {
      throw new Error(`Artefato diário inválido para ${date}`);
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO daily_artifacts
          (date, world_id, map_id, generator_version, dataset_version, world_json, map_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        date,
        world.id,
        map.id,
        world.generatorVersion,
        world.datasetVersion,
        JSON.stringify(world),
        JSON.stringify(map),
      );
    return this.get(date) ?? { world, map };
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
