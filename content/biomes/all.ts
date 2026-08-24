import { brasilEntries } from "./brasil.js";
import { cienciaEntries } from "./ciencia.js";
import { cotidianoEntries } from "./cotidiano.js";
import { culturaPopEntries } from "./cultura-pop.js";
import { historiaEntries } from "./historia.js";
import { naturezaEntries } from "./natureza.js";

export const bundledEntries = [
  ...cotidianoEntries,
  ...cienciaEntries,
  ...historiaEntries,
  ...culturaPopEntries,
  ...naturezaEntries,
  ...brasilEntries,
];
