import type { DailyMap } from "../generation/types.js";

export async function loadDailyMap(date?: string): Promise<DailyMap> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await fetch(`/api/daily${query}`);
  if (!response.ok) throw new Error("Não foi possível abrir o mundo de hoje.");
  const body = (await response.json()) as { map: DailyMap };
  return body.map;
}

export type TelemetryEventName =
  | "run_started"
  | "word_solved"
  | "powerup_used"
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
