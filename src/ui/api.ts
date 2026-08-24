import type { DailyMap } from "../generation/types.js";

export interface ArchiveEntry {
  date: string;
  mapId: string;
  words: number;
}

export async function loadDailyMap(): Promise<DailyMap> {
  const response = await fetch("/api/daily");
  if (!response.ok) throw new Error("Não foi possível abrir o mundo de hoje.");
  return ((await response.json()) as { map: DailyMap }).map;
}

export async function loadDailyMapByDate(date: string): Promise<DailyMap> {
  const response = await fetch(`/api/daily/${encodeURIComponent(date)}`);
  if (!response.ok) throw new Error("Essa expedição ainda não existe no arquivo.");
  return ((await response.json()) as { map: DailyMap }).map;
}

export async function loadFreeMap(seed: string): Promise<DailyMap> {
  const response = await fetch(`/api/world?seed=${encodeURIComponent(seed)}`);
  if (response.status === 429) {
    throw new Error("Muitos mundos novos agora há pouco. Tente de novo em um minuto.");
  }
  if (!response.ok) throw new Error("Não foi possível desenhar esse mundo.");
  return ((await response.json()) as { map: DailyMap }).map;
}

export async function loadArchive(limit = 8): Promise<ArchiveEntry[]> {
  const response = await fetch(`/api/archive?limit=${limit}`);
  if (!response.ok) return [];
  return ((await response.json()) as { entries: ArchiveEntry[] }).entries;
}

export type TelemetryEventName =
  | "run_started"
  | "word_solved"
  | "item_used"
  | "key_collected"
  | "area_captured"
  | "victory";

export function sendTelemetry(
  enabled: boolean,
  event: {
    runId: string;
    mapId: string;
    event: TelemetryEventName;
    elapsedActiveMs: number;
    payload: Record<string, string | number | boolean>;
  },
): void {
  if (!enabled) return;
  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}
