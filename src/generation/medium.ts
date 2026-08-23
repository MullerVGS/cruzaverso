import { BIOMES } from "../content/catalog.js";
import { GAME_BALANCE, POWERUP_DEFINITIONS } from "../config/game.js";
import { SeededRandom, seedFingerprint } from "./random.js";
import {
  cellsForWord,
  coordinateKey,
  type Bounds,
  type Coordinate,
  type DailyMap,
  type DailyWorld,
  type MapObject,
  type PlacedWord,
  type PowerupType,
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

const POWERUPS = Object.keys(POWERUP_DEFINITIONS) as PowerupType[];

function pickPowerup(random: SeededRandom): PowerupType {
  const totalWeight = POWERUPS.reduce(
    (sum, type) => sum + POWERUP_DEFINITIONS[type].spawnWeight,
    0,
  );
  let cursor = random.float() * totalWeight;
  for (const type of POWERUPS) {
    cursor -= POWERUP_DEFINITIONS[type].spawnWeight;
    if (cursor <= 0) return type;
  }
  return POWERUPS.at(-1) as PowerupType;
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

function parseCoordinate(key: string): Coordinate {
  const [x, y] = key.split(",").map(Number);
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) {
    throw new Error(`Coordenada inválida: ${key}`);
  }
  return { x, y };
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
  const spawn = parseCoordinate(crossingKey);
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
  const biomes = new Set(selected.map((word) => word.biome)).size;
  const branchDistances = ordered.slice(0, selected.length).map(({ steps }) => steps);
  const depth = Math.max(0, ...branchDistances);
  const score =
    selected.length * 20 +
    crossings * 6 +
    cycles * 65 +
    degree * 4 +
    biomes * 12 +
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
        const coordinate = parseCoordinate(candidate.key);
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

  const occupied = new Set(objects.map((object) => coordinateKey(object.position)));
  const powerupCount = random.int(
    GAME_BALANCE.medium.powerups.minInclusive,
    GAME_BALANCE.medium.powerups.maxExclusive,
  );
  const powerupCandidates = random.shuffle(
    [...distances.entries()]
      .filter(([key, distance]) => key !== spawnKey && !occupied.has(key) && distance >= 2)
      .map(([key]) => parseCoordinate(key)),
  );
  for (let index = 0; index < Math.min(powerupCount, powerupCandidates.length); index += 1) {
    const position = powerupCandidates[index];
    if (!position) continue;
    objects.push({
      id: `powerup-${index + 1}`,
      type: "powerup",
      powerupType: pickPowerup(random),
      position,
    });
  }
  return objects;
}

export function generateMediumMap(world: DailyWorld): DailyMap {
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
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      coordinateKey(left.spawn).localeCompare(coordinateKey(right.spawn)),
  );
  const section = candidates[0];
  if (!section || section.words.length === 0) throw new Error("Mundo sem seção Medium viável");

  const map: DailyMap = {
    schemaVersion: 1,
    id: `${world.date}-medium-${seedFingerprint(`${world.seed}:medium`)}`,
    worldId: world.id,
    date: world.date,
    seed: `${world.seed}:medium`,
    size: "medium",
    biomeSites: world.biomeSites,
    words: section.words,
    bounds: boundsForWords(section.words),
    spawn: section.spawn,
    objects: placeObjects(section, world.seed),
    objective: { keysRequired: 2, keysAvailable: 3 },
    report: {
      valid: false,
      words: section.words.length,
      crossings: section.crossings,
      cycles: section.cycles,
      biomes: new Set(section.words.map((word) => word.biome)).size,
      score: section.score,
      errors: [],
    },
  };
  const errors = validateDailyMap(map);
  map.report.errors = errors;
  map.report.valid = errors.length === 0;
  return map;
}

export function validateDailyMap(map: DailyMap): string[] {
  const errors: string[] = [];
  if (map.words.length === 0) return ["Mapa sem palavras"];

  const cellGraph = buildCellGraph(map.words);
  const spawnKey = coordinateKey(map.spawn);
  if (!cellGraph.has(spawnKey)) errors.push("Spawn fora dos caminhos");

  const distances = distanceFromSpawn(cellGraph, map.spawn);
  if (distances.size !== cellGraph.size) errors.push("Caminhos desconectados no recorte");

  const keys = map.objects.filter((object) => object.type === "key");
  const exits = map.objects.filter((object) => object.type === "exit");
  if (keys.length !== 3) errors.push("O mapa precisa ter exatamente três chaves");
  if (exits.length !== 1) errors.push("O mapa precisa ter exatamente uma saída");

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
  return errors;
}
