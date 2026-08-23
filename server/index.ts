import { buildServer } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const dataDirectory = process.env.DATA_DIR ?? "/data";

const app = await buildServer({
  dataDirectory,
  serveFrontend: true,
  logger: true,
  scheduler: true,
  debug: process.env.ENABLE_DEBUG === "true",
});

await app.listen({ host: "0.0.0.0", port });
