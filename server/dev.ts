import { createServer as createViteServer } from "vite";

import { buildServer } from "./app.js";

const api = await buildServer({
  dataDirectory: process.env.DATA_DIR ?? ".data",
  logger: true,
  scheduler: true,
  debug: true,
});
await api.listen({ host: "127.0.0.1", port: 3000 });

const vite = await createViteServer({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" },
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
