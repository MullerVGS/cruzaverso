import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { join } from "node:path";
import { z } from "zod";

import { DailyStore } from "./daily-store.js";

export const CANONICAL_TIME_ZONE = "America/Sao_Paulo";

export interface ServerOptions {
  dataDirectory: string;
  serveFrontend?: boolean;
  logger?: boolean;
  scheduler?: boolean;
  debug?: boolean;
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
          "powerup_used",
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
            powerupType: z.string().max(48).optional(),
            capturedObjects: z.number().int().nonnegative().optional(),
            wordsTotal: z.number().int().nonnegative().optional(),
            inventoryCount: z.number().int().nonnegative().optional(),
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
  const store = new DailyStore(options.dataDirectory);
  const debugEnabled = options.debug ?? process.env.ENABLE_DEBUG === "true";
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

  app.get("/api/daily", async (request, reply) => {
    const query = z.object({ date: dateSchema.optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_date" });
    const requestedDate = query.data.date;
    const date = requestedDate && debugEnabled ? requestedDate : canonicalDate();
    return { map: store.getOrCreate(date).map };
  });

  app.get("/api/debug/world", async (request, reply) => {
    if (!debugEnabled) return reply.code(404).send({ error: "not_found" });
    const query = z.object({ date: dateSchema }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_date" });
    return store.getOrCreate(query.data.date);
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
      store.getOrCreate(now.toISODate() as string);
      store.getOrCreate(now.plus({ days: 1 }).toISODate() as string);
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
