import { bundledEntries } from "../../content/entries.js";
import { buildContentCatalog, type ContentCatalog } from "./catalog.js";

let cachedCatalog: ContentCatalog | undefined;

export function loadBundledCatalog(): ContentCatalog {
  cachedCatalog ??= buildContentCatalog(bundledEntries);
  return cachedCatalog;
}
