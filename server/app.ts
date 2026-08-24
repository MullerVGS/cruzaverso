import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { join } from "node:path";
import { z } from "zod";

import { GenerationGate } from "./generation-gate.js";
import { MapStore, normalizeSeed } from "./map-store.js";

export const CANONICAL_TIME_ZONE = "America/Sao_Paulo";

export interface ServerOptions {
  dataDirectory: string;
  serveFrontend?: boolean;
  logger?: boolean;
  scheduler?: boolean;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const telemetrySchema = z
  .object({ optOut: z.literal(true) })
  .strict()
  .or(
    z
      .object({
        runId: z.string().uuid(),
        mapId: z.string().min(1).max(160),
        event: z.enum([
          "run_started",
          "word_solved",
          "item_used",
          "key_collected",
          "area_captured",
          "victory",
        ]),
        elapsedActiveMs: z.number().int().nonnegative(),
        payload: z
          .object({
            solvedWords: z.number().int().nonnegative().optional(),
            availableWords: z.number().int().nonnegative().optional(),
            keysCollected: z.number().int().nonnegative().optional(),
            itemType: z.string().max(48).optional(),
            capturedObjects: z.number().int().nonnegative().optional(),
            wordsTotal: z.number().int().nonnegative().optional(),
            credits: z.number().int().nonnegative().optional(),
            creditsEarned: z.number().int().nonnegative().optional(),
          })
          .strict(),
      })
      .strict(),
  );

function canonicalDate(): string {
  return DateTime.now().setZone(CANONICAL_TIME_ZONE).toISODate() as string;
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const store = new MapStore(options.dataDirectory);
  const gate = new GenerationGate({ perIpPerMinute: 5, globalPerHour: 60 });
  let scheduler: ReturnType<typeof setInterval> | undefined;

  app.addHook("onClose", async () => {
    if (scheduler) clearInterval(scheduler);
    store.close();
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "cruzaverso",
    timeZone: CANONICAL_TIME_ZONE,
  }));

  app.get("/api/daily", async () => ({ map: store.getOrCreateDaily(canonicalDate()).map }));

  app.get("/api/daily/:date", async (request, reply) => {
    const params = z.object({ date: dateSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_date" });
    // A comparação de string basta porque o formato ISO é ordenável, e ela é o
    // que impede pedir a edição de amanhã antes da hora.
    if (params.data.date > canonicalDate()) return reply.code(404).send({ error: "not_found" });
    const artifact = store.getDaily(params.data.date);
    if (!artifact) return reply.code(404).send({ error: "not_found" });
    return { map: artifact.map };
  });

  app.get("/api/archive", async (request, reply) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(60).default(10) })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_limit" });
    return { entries: store.listDaily(query.data.limit, canonicalDate()) };
  });

  app.get("/api/world", async (request, reply) => {
    const query = z.object({ seed: z.string().min(1).max(80) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_seed" });
    const seed = normalizeSeed(query.data.seed);
    if (!seed) return reply.code(400).send({ error: "invalid_seed" });
    const cached = store.getFree(seed);
    if (cached) return { map: cached.map, seed };
    const verdict = gate.tryAcquire(request.ip);
    if (verdict !== "ok") return reply.code(429).send({ error: verdict });
    const artifact = await gate.serialize(async () => store.createFree(seed));
    return { map: artifact.map, seed };
  });

  app.post("/api/telemetry", async (request, reply) => {
    const parsed = telemetrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_event" });
    if ("optOut" in parsed.data) return reply.code(204).send();
    if (process.env.TELEMETRY_ENABLED !== "false") store.recordTelemetry(parsed.data);
    return reply.code(202).send({ accepted: true });
  });

  if (options.scheduler) {
    const generateCurrentAndNext = () => {
      const now = DateTime.now().setZone(CANONICAL_TIME_ZONE);
      for (const date of [now, now.plus({ days: 1 })]) {
        try {
          store.getOrCreateDaily(date.toISODate() as string);
        } catch (error) {
          app.log.error({ error, date: date.toISODate() }, "Falha ao materializar edição; nova tentativa ocorrerá pelo scheduler");
        }
      }
    };
    generateCurrentAndNext();
    scheduler = setInterval(generateCurrentAndNext, 30 * 60 * 1_000);
    scheduler.unref();
  }

  if (options.serveFrontend) {
    await app.register(fastifyStatic, {
      root: join(process.cwd(), "dist"),
      wildcard: false,
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
