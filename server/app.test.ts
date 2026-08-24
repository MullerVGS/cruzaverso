import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DateTime } from "luxon";

import { CANONICAL_TIME_ZONE, buildServer } from "./app.js";

const GENERATION_TEST_TIMEOUT_MS = 20_000;

describe("HTTP público", () => {
  it("expõe um healthcheck operacional sem depender de artefato diário", async () => {
    const app = await buildServer({
      dataDirectory: "/tmp/cruzaverso-health-test",
      serveFrontend: false,
    });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "cruzaverso",
      timeZone: "America/Sao_Paulo",
    });

    await app.close();
  });

  it("persiste e republica o mesmo mapa diário canônico", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-daily-"));
    const app = await buildServer({ dataDirectory, serveFrontend: false });

    // Fora do modo debug o `?date=` é ignorado: pedir uma data arbitrária tem
    // que devolver o dia canônico, senão dá para espiar edições futuras. O teste
    // pede uma data deliberadamente distante para provar isso — comparar com
    // string fixa só funcionava enquanto "hoje" coincidisse com ela.
    const canonico = DateTime.now().setZone(CANONICAL_TIME_ZONE).toISODate() as string;
    const first = await app.inject({
      method: "GET",
      url: "/api/daily?date=2031-12-25",
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/daily?date=2031-12-25",
    });

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(first.json().map.date).toBe(canonico);
    expect(first.json().map.date).not.toBe("2031-12-25");
    expect(first.json().map.objects.filter((object: { type: string }) => object.type === "key")).toHaveLength(3);
    await expect(readFile(join(dataDirectory, "cruzaverso.sqlite"))).resolves.toBeTruthy();

    await app.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("aceita telemetria anônima mínima e respeita opt-out", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-telemetry-"));
    const app = await buildServer({ dataDirectory, serveFrontend: false });

    const accepted = await app.inject({
      method: "POST",
      url: "/api/telemetry",
      payload: {
        runId: "6e2eca51-f32b-41bd-8a47-b61945788156",
        mapId: "2026-08-23-medium-demo",
        event: "word_solved",
        elapsedActiveMs: 1234,
        payload: { solvedWords: 2 },
      },
    });
    const declined = await app.inject({
      method: "POST",
      url: "/api/telemetry",
      payload: { optOut: true },
    });

    expect(accepted.statusCode).toBe(202);
    expect(declined.statusCode).toBe(204);
    await app.close();
  });

  it("mantém a inspeção do mundo atrás da flag de debug", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-debug-"));
    const publicApp = await buildServer({ dataDirectory, serveFrontend: false, debug: false });
    const hidden = await publicApp.inject({ method: "GET", url: "/api/debug/world?date=2026-08-23" });
    expect(hidden.statusCode).toBe(404);
    await publicApp.close();

    const debugApp = await buildServer({ dataDirectory, serveFrontend: false, debug: true });
    const visible = await debugApp.inject({ method: "GET", url: "/api/debug/world?date=2026-08-23" });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().world.report.valid).toBe(true);
    expect(visible.json().map.report.valid).toBe(true);
    const arbitrary = await debugApp.inject({ method: "GET", url: "/api/debug/world?seed=nebulosa" });
    expect(arbitrary.statusCode).toBe(200);
    expect(arbitrary.json().world.seed).toContain("nebulosa");
    await debugApp.close();
  }, GENERATION_TEST_TIMEOUT_MS);
});
