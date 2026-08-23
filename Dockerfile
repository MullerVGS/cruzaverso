FROM node:22-bookworm-slim AS deps

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS test

COPY . .
CMD ["npm", "test"]

FROM deps AS build

COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS e2e

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npm", "run", "test:e2e"]

FROM deps AS prod-deps

RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/content ./content

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["npm", "start"]
