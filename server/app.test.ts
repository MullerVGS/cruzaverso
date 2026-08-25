import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import Database from "better-sqlite3";
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

    // `/api/daily` não tem parâmetro de data: pedir uma arbitrária tem que
    // devolver o dia canônico, senão dá para espiar edições futuras. Comparar
    // com string fixa só funcionava enquanto "hoje" coincidisse com ela.
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

  it("grava telemetria somente após opt-in explícito do operador", async () => {
    const previous = process.env.TELEMETRY_ENABLED;
    const payload = {
      runId: "6e2eca51-f32b-41bd-8a47-b61945788156",
      mapId: "2026-08-23-medium-demo",
      event: "word_solved",
      elapsedActiveMs: 1234,
      payload: { solvedWords: 2 },
    };
    const countEvents = (directory: string) => {
      const database = new Database(join(directory, "cruzaverso.sqlite"), { readonly: true });
      const result = database.prepare("SELECT count(*) AS total FROM telemetry_events").get() as {
        total: number;
      };
      database.close();
      return result.total;
    };

    try {
      delete process.env.TELEMETRY_ENABLED;
      const disabledDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-telemetry-off-"));
      const disabled = await buildServer({ dataDirectory: disabledDirectory, serveFrontend: false });
      const ignored = await disabled.inject({ method: "POST", url: "/api/telemetry", payload });
      await disabled.close();

      expect(ignored.statusCode).toBe(204);
      expect(countEvents(disabledDirectory)).toBe(0);

      process.env.TELEMETRY_ENABLED = "true";
      const enabledDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-telemetry-on-"));
      const enabled = await buildServer({ dataDirectory: enabledDirectory, serveFrontend: false });
      const accepted = await enabled.inject({ method: "POST", url: "/api/telemetry", payload });
      const declined = await enabled.inject({
        method: "POST",
        url: "/api/telemetry",
        payload: { optOut: true },
      });
      await enabled.close();

      expect(accepted.statusCode).toBe(202);
      expect(declined.statusCode).toBe(204);
      expect(countEvents(enabledDirectory)).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.TELEMETRY_ENABLED;
      else process.env.TELEMETRY_ENABLED = previous;
    }
  });

  it("não existe mais rota de debug", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-nodebug-"));
    const app = await buildServer({ dataDirectory, serveFrontend: false });
    const byDate = await app.inject({ method: "GET", url: "/api/debug/world?date=2026-08-23" });
    const bySeed = await app.inject({ method: "GET", url: "/api/debug/world?seed=nebulosa" });
    expect(byDate.statusCode).toBe(404);
    expect(bySeed.statusCode).toBe(404);
    await app.close();
  });

  it("recusa data futura e data nunca gerada no arquivo por data", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-archive-"));
    const app = await buildServer({ dataDirectory, serveFrontend: false });
    const future = DateTime.now().setZone(CANONICAL_TIME_ZONE).plus({ days: 5 }).toISODate() as string;

    const tomorrow = await app.inject({ method: "GET", url: `/api/daily/${future}` });
    const ancient = await app.inject({ method: "GET", url: "/api/daily/2020-01-01" });
    const malformed = await app.inject({ method: "GET", url: "/api/daily/ontem" });

    expect(tomorrow.statusCode).toBe(404);
    expect(ancient.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("lista no arquivo somente o que já foi persistido", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-list-"));
    const app = await buildServer({ dataDirectory, serveFrontend: false });

    const empty = await app.inject({ method: "GET", url: "/api/archive" });
    expect(empty.json().entries).toEqual([]);

    await app.inject({ method: "GET", url: "/api/daily" });
    const filled = await app.inject({ method: "GET", url: "/api/archive?limit=5" });
    const entries = filled.json().entries as Array<{ date: string; words: number }>;
    const canonical = DateTime.now().setZone(CANONICAL_TIME_ZONE).toISODate() as string;

    expect(entries).toHaveLength(1);
    expect(entries[0]?.date).toBe(canonical);
    expect(entries[0]?.words).toBeGreaterThan(10);

    const replayable = await app.inject({ method: "GET", url: `/api/daily/${canonical}` });
    expect(replayable.statusCode).toBe(200);
    await app.close();
  }, GENERATION_TEST_TIMEOUT_MS);

  it("serve a seed livre normalizada e reusa o cache na segunda chamada", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "cruzaverso-free-"));
    const app = await buildServer({ dataDirectory, serveFrontend: false });

    const first = await app.inject({ method: "GET", url: "/api/world?seed=Nebulosa%2042" });
    expect(first.statusCode).toBe(200);
    const body = first.json() as { seed: string; map: { id: string; mode: string; objective: { kind: string } } };
    expect(body.seed).toBe("nebulosa-42");
    expect(body.map.mode).toBe("free");
    expect(body.map.objective.kind).toBe("sandbox");
    expect(body.map.id.startsWith("livre-m2-")).toBe(true);

    // A segunda chamada não pode pagar os segundos de geração de novo: é o
    // cache por seed que torna a rota pública viável.
    const started = Date.now();
    const second = await app.inject({ method: "GET", url: "/api/world?seed=nebulosa-42" });
    expect(second.statusCode).toBe(200);
    expect(second.json().map.id).toBe(body.map.id);
    expect(Date.now() - started).toBeLessThan(1_000);

    const empty = await app.inject({ method: "GET", url: "/api/world?seed=%20%20" });
    expect(empty.statusCode).toBe(400);
    await app.close();
  }, GENERATION_TEST_TIMEOUT_MS * 3);

});
