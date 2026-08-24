import { createServer as createViteServer } from "vite";

import { buildServer } from "./app.js";

const apiPort = Number(process.env.PORT ?? 3000);
const vitePort = Number(process.env.VITE_PORT ?? 5173);

const api = await buildServer({
  dataDirectory: process.env.DATA_DIR ?? ".data",
  logger: true,
  scheduler: true,
});
await api.listen({ host: "127.0.0.1", port: apiPort });

const vite = await createViteServer({
  server: {
    host: "0.0.0.0",
    port: vitePort,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
await vite.listen();
vite.printUrls();

const close = async () => {
  await Promise.all([api.close(), vite.close()]);
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
