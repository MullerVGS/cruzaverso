import { BIOMES } from "../content/catalog.js";
import { GAME_BALANCE } from "../config/game.js";
import { SeededRandom, seedFingerprint } from "./random.js";
import {
  cellsForWord,
  coordinateKey,
  parseCoordinateKey,
  type Bounds,
  type Coordinate,
  type DailyMap,
  type DailyWorld,
  type MapMode,
  type MapObject,
  type MapObjective,
  type PlacedWord,
} from "./types.js";

interface WordGraph {
  adjacency: Map<string, Set<string>>;
  crossings: Map<string, string[]>;
}

interface CandidateSection {
  spawn: Coordinate;
  words: PlacedWord[];
  crossings: number;
  cycles: number;
  score: number;
}

interface RouteAnalysis {
  plans: Array<{ keyIds: [string, string]; requiredWords: string[] }>;
  diversity: number;
  mandatoryWords: number;
  score: number;
}

interface EvaluatedSection extends CandidateSection {
  objects: MapObject[];
  routes: RouteAnalysis;
  finalScore: number;
}

function buildWordGraph(words: readonly PlacedWord[]): WordGraph {
  const occupying = new Map<string, string[]>();
  for (const word of words) {
    for (const cell of cellsForWord(word)) {
      const key = coordinateKey(cell);
      const ids = occupying.get(key) ?? [];
      ids.push(word.id);
      occupying.set(key, ids);
    }
  }

  const adjacency = new Map(words.map((word) => [word.id, new Set<string>()]));
  const crossings = new Map<string, string[]>();
  for (const [key, ids] of occupying) {
    if (ids.length !== 2) continue;
    crossings.set(key, ids);
    const [left, right] = ids;
    if (!left || !right) continue;
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  }
  return { adjacency, crossings };
}

function boundsForWords(words: readonly PlacedWord[], padding = 2): Bounds {
  const cells = words.flatMap((word) => cellsForWord(word));
  return {
    minX: Math.min(...cells.map((cell) => cell.x)) - padding,
    minY: Math.min(...cells.map((cell) => cell.y)) - padding,
    maxX: Math.max(...cells.map((cell) => cell.x)) + padding,
    maxY: Math.max(...cells.map((cell) => cell.y)) + padding,
  };
}

function graphDistance(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  origins: readonly string[],
): Map<string, number> {
  const distance = new Map<string, number>();
  const queue = [...origins];
  for (const origin of origins) distance.set(origin, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    const nextDistance = (distance.get(current) ?? 0) + 1;
    for (const neighbor of graph.get(current) ?? []) {
      if (distance.has(neighbor)) continue;
      distance.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }
  return distance;
}

function growSection(
  world: DailyWorld,
  graph: WordGraph,
  crossingKey: string,
  targetWords: number,
  random: SeededRandom,
): CandidateSection {
  const wordById = new Map(world.words.map((word) => [word.id, word]));
  const origins = graph.crossings.get(crossingKey) ?? [];
  const distance = graphDistance(graph.adjacency, origins);
  const spawn = parseCoordinateKey(crossingKey);
  const ordered = [...distance.entries()]
    .map(([id, steps]) => ({
      word: wordById.get(id) as PlacedWord,
      steps,
      jitter: random.fork(`${crossingKey}:${id}`).float(),
    }))
    .filter((candidate) => Boolean(candidate.word))
    .sort(
      (left, right) =>
        left.steps - right.steps || left.jitter - right.jitter || left.word.id.localeCompare(right.word.id),
    );

  const selected = ordered.slice(0, Math.min(targetWords, ordered.length)).map(({ word }) => word);
  const selectedIds = new Set(selected.map((word) => word.id));
  let crossings = 0;
  for (const ids of graph.crossings.values()) {
    if (ids.every((id) => selectedIds.has(id))) crossings += 1;
  }
  const cycles = Math.max(0, crossings - selected.length + 1);
  const degree = origins.reduce((total, id) => total + (graph.adjacency.get(id)?.size ?? 0), 0);
  const branchDistances = ordered.slice(0, selected.length).map(({ steps }) => steps);
  const depth = Math.max(0, ...branchDistances);
  const score =
    selected.length * 20 +
    crossings * 6 +
    cycles * 65 +
    degree * 4 +
    depth * 2 -
    Math.abs(selected.length - targetWords) * 30;
  return { spawn, words: selected, crossings, cycles, score };
}

function buildCellGraph(words: readonly PlacedWord[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const word of words) {
    const cells = cellsForWord(word);
    for (const cell of cells) {
      const key = coordinateKey(cell);
      if (!graph.has(key)) graph.set(key, new Set());
    }
    for (let index = 1; index < cells.length; index += 1) {
      const previous = cells[index - 1];
      const current = cells[index];
      if (!previous || !current) continue;
      const previousKey = coordinateKey(previous);
      const currentKey = coordinateKey(current);
      graph.get(previousKey)?.add(currentKey);
      graph.get(currentKey)?.add(previousKey);
    }
  }
  return graph;
}

function distanceFromSpawn(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  spawn: Coordinate,
): Map<string, number> {
  return graphDistance(graph, [coordinateKey(spawn)]);
}

function pickSpreadCoordinates(
  candidates: readonly { key: string; distance: number }[],
  amount: number,
  random: SeededRandom,
): Coordinate[] {
  const selected: Coordinate[] = [];
  const available = [...candidates];
  while (selected.length < amount && available.length > 0) {
    const ranked = available
      .map((candidate) => {
        const coordinate = parseCoordinateKey(candidate.key);
        const separation =
          selected.length === 0
            ? 0
            : Math.min(
                ...selected.map(
                  (other) => Math.abs(other.x - coordinate.x) + Math.abs(other.y - coordinate.y),
                ),
              );
        return {
          ...candidate,
          coordinate,
          score: candidate.distance * 10 + separation * 4 + random.fork(candidate.key).float(),
        };
      })
      .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
    const winner = ranked[0];
    if (!winner) break;
    selected.push(winner.coordinate);
    available.splice(
      available.findIndex((candidate) => candidate.key === winner.key),
      1,
    );
  }
  return selected;
}

function placeObjects(section: CandidateSection, seed: string): MapObject[] {
  const random = new SeededRandom(`${seed}:objects`);
  const graph = buildCellGraph(section.words);
  const distances = distanceFromSpawn(graph, section.spawn);
  const spawnKey = coordinateKey(section.spawn);
  const rankedCells = [...distances.entries()]
    .filter(([key, distance]) => key !== spawnKey && distance >= 3)
    .map(([key, distance]) => ({ key, distance }));
  const fallbackCells = [...distances.entries()]
    .filter(([key]) => key !== spawnKey)
    .map(([key, distance]) => ({ key, distance }));
  const objectivePositions = pickSpreadCoordinates(
    rankedCells.length >= 4 ? rankedCells : fallbackCells,
    4,
    random.fork("objectives"),
  );
  if (objectivePositions.length < 4) throw new Error("Seção sem espaço para posicionar objetivos");

  const [exitPosition, ...keyPositions] = objectivePositions;
  const objects: MapObject[] = [
    { id: "exit", type: "exit", position: exitPosition as Coordinate },
    ...keyPositions.map(
      (position, index) => ({ id: `key-${index + 1}`, type: "key", position }) as MapObject,
    ),
  ];

  return objects;
}

function placeCoins(section: CandidateSection, seed: string): MapObject[] {
  const random = new SeededRandom(`${seed}:coins`);
  const graph = buildCellGraph(section.words);
  const distances = distanceFromSpawn(graph, section.spawn);
  const spawnKey = coordinateKey(section.spawn);
  const count = random.int(
    GAME_BALANCE.medium.coins.minInclusive,
    GAME_BALANCE.medium.coins.maxExclusive,
  );
  const candidates = pickSpreadCoordinates(
    [...distances.entries()]
      .filter(([key, distance]) => key !== spawnKey && distance >= 2)
      .map(([key, distance]) => ({ key, distance })),
    count,
    random.fork("spread"),
  );
  return candidates.map((position, index) => ({
    id: `coin-${index + 1}`,
    type: "coin",
    value: GAME_BALANCE.economy.coinValue,
    position,
  }));
}

function wordIdsAt(words: readonly PlacedWord[], position: Coordinate): string[] {
  const key = coordinateKey(position);
  return words
    .filter((word) => cellsForWord(word).some((cell) => coordinateKey(cell) === key))
    .map((word) => word.id);
}

function shortestWordPath(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  origins: readonly string[],
  targets: ReadonlySet<string>,
): string[] | null {
  const previous = new Map<string, string | null>();
  const queue = [...origins];
  for (const origin of origins) previous.set(origin, null);
  let reached: string | undefined;
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    if (targets.has(current)) {
      reached = current;
      break;
    }
    for (const neighbor of graph.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  if (!reached) return null;
  const path: string[] = [];
  let cursor: string | null = reached;
  while (cursor) {
    path.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return path;
}

function analyzeObjectiveRoutes(
  words: readonly PlacedWord[],
  spawn: Coordinate,
  objects: readonly MapObject[],
): RouteAnalysis {
  const graph = buildWordGraph(words).adjacency;
  const origins = wordIdsAt(words, spawn);
  const keys = objects.filter((object) => object.type === "key");
  const exit = objects.find((object) => object.type === "exit");
  const combinations: Array<[MapObject, MapObject]> =
    keys.length === 3
      ? [
          [keys[0] as MapObject, keys[1] as MapObject],
          [keys[0] as MapObject, keys[2] as MapObject],
          [keys[1] as MapObject, keys[2] as MapObject],
        ]
      : [];
  const plans: RouteAnalysis["plans"] = [];
  if (origins.length === 0 || !exit) return { plans, diversity: 0, mandatoryWords: words.length, score: -10_000 };

  for (const [firstKey, secondKey] of combinations) {
    const targets = [firstKey, secondKey, exit];
    const paths = targets.map((object) =>
      shortestWordPath(graph, origins, new Set(wordIdsAt(words, object.position))),
    );
    if (paths.some((path) => !path)) continue;
    const requiredWords = [
      ...new Set(paths.flatMap((path) => path as string[])),
    ].sort();
    plans.push({
      keyIds: [firstKey.id, secondKey.id],
      requiredWords,
    });
  }

  let diversity = 0;
  let comparisons = 0;
  for (let left = 0; left < plans.length; left += 1) {
    for (let right = left + 1; right < plans.length; right += 1) {
      const leftWords = new Set(plans[left]?.requiredWords ?? []);
      const rightWords = new Set(plans[right]?.requiredWords ?? []);
      diversity += [...leftWords].filter((id) => !rightWords.has(id)).length;
      diversity += [...rightWords].filter((id) => !leftWords.has(id)).length;
      comparisons += 1;
    }
  }
  diversity = comparisons === 0 ? 0 : Number((diversity / comparisons).toFixed(2));

  const mandatory = plans[0]
    ? plans[0].requiredWords.filter((id) => plans.every((plan) => plan.requiredWords.includes(id)))
    : [];
  const smallestPlan = Math.min(...plans.map((plan) => plan.requiredWords.length), words.length);
  const score =
    plans.length * 80 +
    diversity * 9 -
    mandatory.length * 8 -
    Math.abs(smallestPlan - 15) * 2;
  return { plans, diversity, mandatoryWords: mandatory.length, score };
}

export interface MediumOptions {
  mode?: MapMode;
}

export function generateMediumMap(world: DailyWorld, options: MediumOptions = {}): DailyMap {
  const mode = options.mode ?? "daily";
  const random = new SeededRandom(`${world.seed}:medium`);
  const graph = buildWordGraph(world.words);
  const targetWords = Math.min(
    world.words.length,
    random.int(
      GAME_BALANCE.medium.targetWords.minInclusive,
      GAME_BALANCE.medium.targetWords.maxExclusive,
    ),
  );
  const candidates = [...graph.crossings.keys()].map((crossingKey) =>
    growSection(world, graph, crossingKey, targetWords, random.fork(crossingKey)),
  );
  const evaluated: EvaluatedSection[] = candidates.map((candidate) => {
    const candidateSeed = `${world.seed}:${coordinateKey(candidate.spawn)}`;
    const objects = placeObjects(candidate, candidateSeed);
    const routes = analyzeObjectiveRoutes(candidate.words, candidate.spawn, objects);
    return {
      ...candidate,
      objects,
      routes,
      finalScore: candidate.score + routes.score,
    };
  });
  evaluated.sort(
    (left, right) =>
      right.finalScore - left.finalScore ||
      coordinateKey(left.spawn).localeCompare(coordinateKey(right.spawn)),
  );
  const section = evaluated[0];
  if (!section || section.words.length === 0) throw new Error("Mundo sem seção Medium viável");

  // A avaliação acima roda igual nos dois modos, com chaves e saída: é ela que
  // escolhe uma seção bem conectada, e manter o critério faz a mesma seed dar a
  // mesma seção. A troca por moedas só acontece na seção vencedora.
  const sectionSeed = `${world.seed}:${coordinateKey(section.spawn)}`;
  const objects = mode === "free" ? placeCoins(section, sectionSeed) : section.objects;
  const objective: MapObjective =
    mode === "free"
      ? { kind: "sandbox" }
      : {
          kind: "keys-and-exit",
          keysRequired: GAME_BALANCE.medium.keysRequired,
          keysAvailable: GAME_BALANCE.medium.keysAvailable,
        };

  const map: DailyMap = {
    schemaVersion: 2,
    // O dataset entra na impressão digital: catálogo diferente produz outro
    // quebra-cabeça, e sem isso ele herdaria o mesmo id — o save local passaria
    // na checagem de `mapId` e escreveria letras nas células erradas.
    id: `${world.date}-m2-${seedFingerprint(`${world.seed}:medium:${world.datasetVersion}`)}`,
    worldId: world.id,
    configVersion: world.configVersion,
    date: world.date,
    seed: `${world.seed}:medium`,
    size: "medium",
    biomeSites: world.biomeSites,
    biomeField: world.biomeField,
    words: section.words,
    bounds: boundsForWords(section.words),
    spawn: section.spawn,
    mode,
    objects,
    objective,
    report: {
      valid: false,
      words: section.words.length,
      crossings: section.crossings,
      cycles: section.cycles,
      biomes: new Set(section.words.map((word) => word.biome)).size,
      score: section.finalScore,
      routeDiversity: section.routes.diversity,
      mandatoryWords: section.routes.mandatoryWords,
      routePlans: section.routes.plans,
      candidateReports: evaluated.map((candidate) => ({
        spawn: candidate.spawn,
        words: candidate.words.length,
        cycles: candidate.cycles,
        routeDiversity: candidate.routes.diversity,
        mandatoryWords: candidate.routes.mandatoryWords,
        score: candidate.finalScore,
      })),
      errors: [],
    },
  };
  const errors = validateMediumMap(map);
  map.report.errors = errors;
  map.report.valid = errors.length === 0;
  return map;
}

export function validateMediumMap(map: DailyMap): string[] {
  const errors: string[] = [];
  if (map.words.length === 0) return ["Mapa sem palavras"];

  const cellGraph = buildCellGraph(map.words);
  const spawnKey = coordinateKey(map.spawn);
  if (!cellGraph.has(spawnKey)) errors.push("Spawn fora dos caminhos");

  const distances = distanceFromSpawn(cellGraph, map.spawn);
  if (distances.size !== cellGraph.size) errors.push("Caminhos desconectados no recorte");

  if (map.mode === "daily") {
    const keys = map.objects.filter((object) => object.type === "key");
    const exits = map.objects.filter((object) => object.type === "exit");
    if (keys.length !== 3) errors.push("O mapa precisa ter exatamente três chaves");
    if (exits.length !== 1) errors.push("O mapa precisa ter exatamente uma saída");
  } else {
    const coins = map.objects.filter((object) => object.type === "coin");
    if (coins.length < GAME_BALANCE.medium.coins.minInclusive) {
      errors.push("O mapa livre precisa ter pelo menos cinco moedas");
    }
    if (map.objects.some((object) => object.type !== "coin")) {
      errors.push("O mapa livre não pode ter chave nem saída");
    }
  }

  const occupied = new Set<string>();
  for (const object of map.objects) {
    const key = coordinateKey(object.position);
    if (!cellGraph.has(key)) errors.push(`Objeto ${object.id} fora dos caminhos`);
    if (!distances.has(key)) errors.push(`Objeto ${object.id} inalcançável`);
    if (occupied.has(key)) errors.push(`Objetos sobrepostos em ${key}`);
    occupied.add(key);
  }

  const biomeIds = new Set(BIOMES);
  if (map.words.some((word) => !biomeIds.has(word.biome))) errors.push("Bioma inválido no recorte");
  if (map.report.cycles < 1) errors.push("Recorte sem rota alternativa");
  if (map.mode === "daily") {
    const routes = analyzeObjectiveRoutes(map.words, map.spawn, map.objects);
    if (routes.plans.length !== 3) errors.push("Nem todas as combinações de duas chaves são alcançáveis");
    if (routes.plans.every((plan) => plan.requiredWords.length >= map.words.length)) {
      errors.push("Objetivo exige completar toda a crossword");
    }
  }
  return errors;
}
