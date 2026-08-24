import { DateTime } from "luxon";

import { CANONICAL_TIME_ZONE } from "../server/app.js";
import { MapStore } from "../server/map-store.js";

const dateArgument = process.argv.find((argument) => /^\d{4}-\d{2}-\d{2}$/.test(argument));
const date = dateArgument ?? (DateTime.now().setZone(CANONICAL_TIME_ZONE).toISODate() as string);
const dataDirectory = process.env.DATA_DIR ?? "/data";
const store = new MapStore(dataDirectory);

try {
  const artifact = store.getOrCreateDaily(date);
  process.stdout.write(
    `${JSON.stringify(
      {
        date,
        worldId: artifact.world.id,
        mapId: artifact.map.id,
        worldWords: artifact.world.words.length,
        mapWords: artifact.map.words.length,
        crossings: artifact.map.report.crossings,
        cycles: artifact.map.report.cycles,
        valid: artifact.map.report.valid,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  store.close();
}
