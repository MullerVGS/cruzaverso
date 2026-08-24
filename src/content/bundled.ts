import { bundledEntries } from "../../content/biomes/all.js";
import { buildContentCatalog, type ContentCatalog } from "./catalog.js";

export const BUNDLED_DATASET_VERSION = "curadoria-v3-1500";

let cachedCatalog: ContentCatalog | undefined;

export function loadBundledCatalog(): ContentCatalog {
  cachedCatalog ??= buildContentCatalog(bundledEntries, BUNDLED_DATASET_VERSION);
  return cachedCatalog;
}
