import { BIOMES, type BiomeId, type ContentCatalog, type ContentEntry } from "../content/catalog.js";
import { GAME_BALANCE } from "../config/game.js";
import {
  biomeFieldSpecFromSeed,
  createBiomeField,
  majorityBiome,
  type BiomeField,
  type BiomeFieldSpec,
} from "./biome-field.js";
import { SeededRandom, seedFingerprint } from "./random.js";
import { crosswordDensity } from "./density.js";
import {
  cellsForWord,
  coordinateKey,
  type BiomeSite,
  type Bounds,
  type DailyWorld,
  type Orientation,
  type PlacedWord,
  type WorldChunk,
} from "./types.js";

export interface WorldGenerationConfig {
  targetWords: number;
  attempts: number;
  chunkCount: number;
  anchorScanLimit: number;
  entriesPerAnchor: number;
  optionsPerPlacement: number;
}

export interface GenerateWorldInput {
  date: string;
  seed?: string;
  catalog: ContentCatalog;
  config?: Partial<WorldGenerationConfig>;
  observer?: WorldGenerationObserver;
}

export type WorldGenerationPhase =
  | "biome-field"
  | "chunks"
  | "word-placed"
  | "attempt-complete"
  | "selected";

export interface WorldGenerationSnapshot {
  readonly phase: WorldGenerationPhase;
  readonly attempt: number;
  readonly biomeSites: readonly BiomeSite[];
  readonly biomeField: Readonly<BiomeFieldSpec>;
  readonly chunks: readonly WorldChunk[];
  readonly words: readonly PlacedWord[];
}

export type WorldGenerationObserver = (snapshot: WorldGenerationSnapshot) => void;

/** Versão do algoritmo; o bump afeta somente edições ainda não publicadas. */
export const GENERATOR_VERSION = "3.0.1";
export const GENERATOR_CONFIG_VERSION = "2.0.0";

const DEFAULT_CONFIG: WorldGenerationConfig = {
  ...GAME_BALANCE.world,
};

interface IndexedCell {
  letter: string;
  words: string[];
  orientations: Orientation[];
}

interface PlacementOption {
  entry: ContentEntry;
  orientation: Orientation;
  start: { x: number; y: number };
  biome: BiomeId;
  crossings: number;
  score: number;
}

function emitSnapshot(
  observer: WorldGenerationObserver | undefined,
  snapshot: WorldGenerationSnapshot,
): void {
  if (observer) observer(structuredClone(snapshot));
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function buildBiomeSites(random: SeededRandom, biomes: readonly BiomeId[]): BiomeSite[] {
  const sites: BiomeSite[] = biomes.map((biome, index) => ({
    id: `biome-${index}-${biome}`,
    biome,
    x: random.int(-26, 27),
    y: random.int(-20, 21),
    radius: random.int(18, 31),
  }));
  for (let index = 0; index < 3; index += 1) {
    const biome = random.pick(biomes);
    sites.push({
      id: `biome-extra-${index}-${biome}`,
      biome,
      x: random.int(-34, 35),
      y: random.int(-26, 27),
      radius: random.int(15, 28),
    });
  }
  return sites;
}

function buildChunks(random: SeededRandom, field: BiomeField, count: number): WorldChunk[] {
  const coordinates = new Map<string, { x: number; y: number }>();
  coordinates.set("0,0", { x: 0, y: 0 });
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  let guard = 0;
  while (coordinates.size < count && guard < count * 80) {
    guard += 1;
    const origin = random.pick([...coordinates.values()]);
    const direction = random.pick(directions);
    const next = { x: origin.x + direction.x, y: origin.y + direction.y };
    coordinates.set(coordinateKey(next), next);
  }

  const chunks: WorldChunk[] = [...coordinates.values()].map((coordinate, index) => {
    const x = coordinate.x * 11;
    const y = coordinate.y * 9;
    return {
      id: `chunk-${index}`,
      x,
      y,
      biome: field.biomeAt(x, y),
      neighbors: [],
    };
  });

  for (const chunk of chunks) {
    for (const other of chunks) {
      if (chunk === other) continue;
      const gridDistance = Math.abs(chunk.x - other.x) / 11 + Math.abs(chunk.y - other.y) / 9;
      if (gridDistance === 1) chunk.neighbors.push(other.id);
    }
    chunk.neighbors.sort();
  }
  return chunks;
}

function indexWords(words: readonly PlacedWord[]): Map<string, IndexedCell> {
  const index = new Map<string, IndexedCell>();
  for (const word of words) {
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      const existing = index.get(key) ?? { letter: cell.letter, words: [], orientations: [] };
      existing.words.push(word.id);
      existing.orientations.push(word.orientation);
      index.set(key, existing);
    }
  }
  return index;
}

function inspectPlacement(
  entry: ContentEntry,
  orientation: Orientation,
  start: { x: number; y: number },
  cells: ReadonlyMap<string, IndexedCell>,
): { valid: boolean; crossings: number } {
  let crossings = 0;
  const candidate = { gridAnswer: entry.gridAnswer, orientation, start };
  for (const cell of cellsForWord(candidate)) {
    const occupied = cells.get(coordinateKey(cell));
    if (occupied) {
      if (
        occupied.letter !== cell.letter ||
        occupied.orientations.includes(orientation) ||
        occupied.orientations.length >= 2
      ) {
        return { valid: false, crossings: 0 };
      }
      crossings += 1;
      continue;
    }

    const neighbors =
      orientation === "horizontal"
        ? [
            { x: cell.x, y: cell.y - 1 },
            { x: cell.x, y: cell.y + 1 },
          ]
        : [
            { x: cell.x - 1, y: cell.y },
            { x: cell.x + 1, y: cell.y },
          ];
    if (neighbors.some((neighbor) => cells.has(coordinateKey(neighbor)))) {
      return { valid: false, crossings: 0 };
    }
  }

  const before = {
    x: start.x - (orientation === "horizontal" ? 1 : 0),
    y: start.y - (orientation === "vertical" ? 1 : 0),
  };
  const after = {
    x: start.x + (orientation === "horizontal" ? entry.gridAnswer.length : 0),
    y: start.y + (orientation === "vertical" ? entry.gridAnswer.length : 0),
  };
  if (cells.has(coordinateKey(before)) || cells.has(coordinateKey(after))) {
    return { valid: false, crossings: 0 };
  }

  return { valid: crossings > 0, crossings };
}

function toPlacedWord(
  entry: ContentEntry,
  index: number,
  orientation: Orientation,
  start: { x: number; y: number },
  biome: BiomeId,
): PlacedWord {
  return {
    id: `word-${index}-${entry.id}`,
    entryId: entry.id,
    answer: entry.answer,
    gridAnswer: entry.gridAnswer,
    clues: entry.clues,
    difficulty: entry.difficulty,
    familiarity: entry.familiarity,
    biome,
    orientation,
    start,
  };
}

function candidateOptions(
  catalog: ContentCatalog,
  words: readonly PlacedWord[],
  used: ReadonlySet<string>,
  field: BiomeField,
  targetChunk: WorldChunk,
  config: Pick<
    WorldGenerationConfig,
    "anchorScanLimit" | "entriesPerAnchor" | "optionsPerPlacement"
  >,
  random: SeededRandom,
): PlacementOption[] {
  const cellIndex = indexWords(words);
  const options: PlacementOption[] = [];
  const evaluatedPlacements = new Set<string>();

  const anchors = words
    .flatMap((word) =>
      cellsForWord(word).map((cell) => ({
        word,
        cell,
        distance: Math.abs(targetChunk.x - cell.x) + Math.abs(targetChunk.y - cell.y),
      })),
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.word.id.localeCompare(right.word.id) ||
        left.cell.index - right.cell.index,
    )
    .slice(0, config.anchorScanLimit);

  for (const { word: anchor, cell: anchorCell } of anchors) {
    const orientation: Orientation = anchor.orientation === "horizontal" ? "vertical" : "horizontal";
    const anchorBiome = field.biomeAt(anchorCell.x, anchorCell.y);
    const indexedEntries = catalog.findByBiomeLetter(anchorBiome, anchorCell.letter);
    const anchorRandom = random.fork(`${anchor.id}:${anchorCell.index}:entries`);
    const offset = indexedEntries.length === 0 ? 0 : anchorRandom.int(0, indexedEntries.length);
    let stride = indexedEntries.length <= 1 ? 1 : anchorRandom.int(1, indexedEntries.length);
    while (indexedEntries.length > 1 && greatestCommonDivisor(stride, indexedEntries.length) !== 1) {
      stride = (stride + 1) % indexedEntries.length || 1;
    }
    const sampledEntries = Array.from(
      { length: Math.min(config.entriesPerAnchor, indexedEntries.length) },
      (_, index) => indexedEntries[(offset + index * stride) % indexedEntries.length],
    ).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

    for (const { entry, positions } of sampledEntries) {
      if (used.has(entry.id)) continue;
      for (const position of positions) {
        const start = {
          x: anchorCell.x - (orientation === "horizontal" ? position : 0),
          y: anchorCell.y - (orientation === "vertical" ? position : 0),
        };
        const placementKey = `${entry.id}:${orientation}:${start.x},${start.y}`;
        if (evaluatedPlacements.has(placementKey)) continue;
        evaluatedPlacements.add(placementKey);
        const cells = cellsForWord({ gridAnswer: entry.gridAnswer, orientation, start });
        const biome = majorityBiome(field, cells);
        if (!entry.biomes.includes(biome)) continue;
        const inspected = inspectPlacement(entry, orientation, start, cellIndex);
        if (!inspected.valid) continue;

        const middle = {
          x: start.x + (orientation === "horizontal" ? (entry.gridAnswer.length - 1) / 2 : 0),
          y: start.y + (orientation === "vertical" ? (entry.gridAnswer.length - 1) / 2 : 0),
        };

        const chunkDistance = Math.abs(targetChunk.x - middle.x) + Math.abs(targetChunk.y - middle.y);
        const spread = Math.min(18, Math.abs(middle.x) + Math.abs(middle.y));
        options.push({
          entry,
          orientation,
          start,
          biome,
          crossings: inspected.crossings,
          score: inspected.crossings * 70 - chunkDistance * 0.45 + spread * 0.08 + random.float(),
        });
      }
    }
  }
  options.sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
  return options.slice(0, config.optionsPerPlacement);
}

function calculateBounds(words: readonly PlacedWord[]): Bounds {
  const cells = words.flatMap((word) => cellsForWord(word));
  return {
    minX: Math.min(...cells.map((cell) => cell.x)),
    minY: Math.min(...cells.map((cell) => cell.y)),
    maxX: Math.max(...cells.map((cell) => cell.x)),
    maxY: Math.max(...cells.map((cell) => cell.y)),
  };
}

function buildAttempt(
  date: string,
  seed: string,
  attempt: number,
  catalog: ContentCatalog,
  config: WorldGenerationConfig,
  observer?: WorldGenerationObserver,
): DailyWorld {
  const random = new SeededRandom(`${seed}:attempt:${attempt}`);
  const availableBiomes = BIOMES.filter((biome) => catalog.byBiome[biome].length > 0);
  if (availableBiomes.length === 0) throw new Error("Catálogo sem biomas publicáveis");
  const biomeSites = buildBiomeSites(random.fork("biomes"), availableBiomes);
  const biomeField = biomeFieldSpecFromSeed(`${seed}:attempt:${attempt}:field`);
  const field = createBiomeField(biomeField, biomeSites);
  const observeAttempt = (
    phase: Exclude<WorldGenerationPhase, "selected">,
    chunks: readonly WorldChunk[] = [],
    words: readonly PlacedWord[] = [],
  ) => emitSnapshot(observer, { phase, attempt, biomeSites, biomeField, chunks, words });
  observeAttempt("biome-field");
  const chunks = buildChunks(random.fork("chunks"), field, config.chunkCount);
  observeAttempt("chunks", chunks);
  const originBiome = field.biomeAt(0, 0);
  // A palavra da origem herda o bioma que ela realmente ocupa, não o da casa
  // (0,0): a maioria decide, e o bioma da origem pode ser uma ilha estreita
  // demais para caber qualquer resposta. Quando ele não abriga nenhuma, o
  // catálogo inteiro entra como reserva — sem isso a seed morre em 500.
  const centeredBiome = (entry: ContentEntry): BiomeId =>
    majorityBiome(
      field,
      cellsForWord({
        gridAnswer: entry.gridAnswer,
        orientation: "horizontal",
        start: { x: -Math.floor(entry.gridAnswer.length / 2), y: 0 },
      }),
    );
  const centeredEntries = catalog.byBiome[originBiome].filter(
    (entry) => centeredBiome(entry) === originBiome,
  );
  const fallbackEntries =
    centeredEntries.length > 0
      ? []
      : catalog.entries.filter((entry) => entry.biomes.includes(centeredBiome(entry)));
  const initialPool = centeredEntries.length > 0 ? centeredEntries : fallbackEntries;
  if (initialPool.length === 0) {
    throw new Error(`Catálogo sem resposta central compatível com a origem ${originBiome}`);
  }
  const initialEntry = random.pick(initialPool);
  const initialStart = { x: -Math.floor(initialEntry.gridAnswer.length / 2), y: 0 };
  const words: PlacedWord[] = [
    toPlacedWord(initialEntry, 0, "horizontal", initialStart, centeredBiome(initialEntry)),
  ];
  const used = new Set([initialEntry.id]);
  observeAttempt("word-placed", chunks, words);

  for (let index = 1; index < config.targetWords; index += 1) {
    const scheduledChunkIndex = index % chunks.length;
    let options: PlacementOption[] = [];
    for (let offset = 0; offset < chunks.length && options.length === 0; offset += 1) {
      const targetChunk = chunks[(scheduledChunkIndex + offset) % chunks.length] as WorldChunk;
      options = candidateOptions(
        catalog,
        words,
        used,
        field,
        targetChunk,
        config,
        random.fork(`placement:${index}:${targetChunk.id}`),
      );
    }
    if (options.length === 0) break;
    const bestCrossingCount = Math.max(...options.map((candidate) => candidate.crossings));
    const densestOptions = options
      .filter((candidate) => candidate.crossings === bestCrossingCount)
      .slice(0, 3);
    const option = random.pick(densestOptions);
    words.push(toPlacedWord(option.entry, index, option.orientation, option.start, option.biome));
    used.add(option.entry.id);
    observeAttempt("word-placed", chunks, words);
  }

  const density = crosswordDensity(words);
  const crossings = density.crossings;
  const cycles = Math.max(0, crossings - words.length + 1);
  const world: DailyWorld = {
    schemaVersion: 2,
    generatorVersion: GENERATOR_VERSION,
    datasetVersion: catalog.datasetVersion,
    configVersion: GENERATOR_CONFIG_VERSION,
    id: `${date}-g2-${seedFingerprint(
      `${seed}:${catalog.datasetVersion}:${catalog.contentFingerprint}:${GENERATOR_VERSION}:${GENERATOR_CONFIG_VERSION}:${JSON.stringify(config)}`,
    )}`,
    date,
    seed,
    biomeSites,
    biomeField,
    chunks,
    words,
    bounds: calculateBounds(words),
    report: {
      valid: false,
      attempt,
      requestedWords: config.targetWords,
      placedWords: words.length,
      crossings,
      cycles,
      checkedCellRatio: density.checkedCellRatio,
      crossedLettersPerWord: density.crossedLettersPerWord,
      score:
        words.length * 10 +
        cycles * 35 +
        crossings * 3 +
        density.checkedCellRatio * 500,
      errors: [],
    },
    candidateReports: [],
  };
  const errors = validateWorld(world);
  world.report.errors = errors;
  world.report.valid = errors.length === 0;
  if (!world.report.valid) world.report.score -= errors.length * 1_000;
  observeAttempt("attempt-complete", chunks, words);
  return world;
}

export function generateDailyWorld(input: GenerateWorldInput): DailyWorld {
  const config = { ...DEFAULT_CONFIG, ...input.config };
  const seed = input.seed ?? `cruzaverso:${input.date}`;
  const candidates = Array.from({ length: config.attempts }, (_, attempt) =>
    buildAttempt(input.date, seed, attempt, input.catalog, config, input.observer),
  );
  candidates.sort((left, right) => right.report.score - left.report.score || left.report.attempt - right.report.attempt);
  const best = candidates[0];
  if (!best) throw new Error("Nenhum mundo candidato foi gerado");
  best.candidateReports = candidates.map((candidate) => ({ ...candidate.report }));
  emitSnapshot(input.observer, {
    phase: "selected",
    attempt: best.report.attempt,
    biomeSites: best.biomeSites,
    biomeField: best.biomeField,
    chunks: best.chunks,
    words: best.words,
  });
  return best;
}

export function validateCrosswordLayout(words: readonly PlacedWord[]): string[] {
  const errors: string[] = [];
  if (words.length === 0) return ["Crossword sem palavras"];

  const entryIds = new Set<string>();
  const cells = new Map<string, Array<{ word: PlacedWord; letter: string }>>();
  for (const word of words) {
    if (entryIds.has(word.entryId)) errors.push(`Resposta repetida: ${word.entryId}`);
    entryIds.add(word.entryId);
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      const occupying = cells.get(key) ?? [];
      occupying.push({ word, letter: cell.letter });
      cells.set(key, occupying);
    }
  }

  const adjacency = new Map(words.map((word) => [word.id, new Set<string>()]));
  for (const [key, occupying] of cells) {
    if (new Set(occupying.map((item) => item.letter)).size > 1) {
      errors.push(`Letras incompatíveis em ${key}`);
    }
    if (occupying.length > 2) errors.push(`Mais de duas palavras em ${key}`);
    if (occupying.length === 2) {
      const [first, second] = occupying;
      if (first?.word.orientation === second?.word.orientation) {
        errors.push(`Sobreposição paralela em ${key}`);
      }
      if (first && second) {
        adjacency.get(first.word.id)?.add(second.word.id);
        adjacency.get(second.word.id)?.add(first.word.id);
      }
    }
  }

  for (const word of words) {
    const wordCells = cellsForWord(word);
    for (const cell of wordCells) {
      const currentWordIds = new Set(
        (cells.get(coordinateKey(cell)) ?? []).map((occupying) => occupying.word.id),
      );
      const sideNeighbors =
        word.orientation === "horizontal"
          ? [
              { x: cell.x, y: cell.y - 1 },
              { x: cell.x, y: cell.y + 1 },
            ]
          : [
              { x: cell.x - 1, y: cell.y },
              { x: cell.x + 1, y: cell.y },
            ];
      if (
        sideNeighbors.some((neighbor) => {
          const neighborOccupants = cells.get(coordinateKey(neighbor)) ?? [];
          return (
            neighborOccupants.length > 0 &&
            !neighborOccupants.some((occupying) => currentWordIds.has(occupying.word.id))
          );
        })
      ) {
        errors.push(`Palavra ${word.id} encosta lateralmente em outra palavra`);
        break;
      }
    }

    const before = {
      x: word.start.x - (word.orientation === "horizontal" ? 1 : 0),
      y: word.start.y - (word.orientation === "vertical" ? 1 : 0),
    };
    const after = {
      x: word.start.x + (word.orientation === "horizontal" ? word.gridAnswer.length : 0),
      y: word.start.y + (word.orientation === "vertical" ? word.gridAnswer.length : 0),
    };
    if (cells.has(coordinateKey(before)) || cells.has(coordinateKey(after))) {
      errors.push(`Palavra ${word.id} encosta pela ponta em outra palavra`);
    }
  }

  const visited = new Set<string>();
  const pending = [words[0]?.id].filter((id): id is string => Boolean(id));
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const neighbor of adjacency.get(id) ?? []) pending.push(neighbor);
  }
  if (visited.size !== words.length) errors.push("Crossword desconectada");
  return errors;
}

export function validateWorld(world: DailyWorld): string[] {
  if (world.words.length === 0) return ["Mundo sem palavras"];
  const errors = validateCrosswordLayout(world.words);
  // O helper de layout também é usado por fixtures unitárias mínimas, que não
  // carregam campo de biomas. Artefatos reais sempre entram neste ramo.
  if (world.biomeField && world.biomeSites?.length > 0) {
    const field = createBiomeField(world.biomeField, world.biomeSites);
    for (const word of world.words) {
      if (word.biome !== majorityBiome(field, cellsForWord(word))) {
        errors.push(`Bioma incorreto na palavra ${word.id}`);
      }
    }
  }
  return errors;
}
