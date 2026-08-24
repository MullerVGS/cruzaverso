import { normalizeGridAnswer } from "../content/catalog.js";
import { GAME_BALANCE } from "../config/game.js";
import {
  cellsForWord,
  coordinateKey,
  parseCoordinateKey,
  type Coordinate,
  type DailyMap,
  type ItemType,
  type MapMode,
  type MapObject,
  type PlacedWord,
} from "../generation/types.js";
import { creditsForCapture, creditsForWord, priceOf } from "./economy.js";

export interface RevealZone extends Coordinate {
  radius: number;
  source: "initial" | "word" | "tutorial" | "item";
}

export interface GameFeedback {
  kind: "incorrect" | "correct" | "unavailable" | "blocked" | "collected";
  message: string;
  subjectId?: string;
}

export interface GameState {
  schemaVersion: 2;
  mapId: string;
  mode: MapMode;
  status: "playing" | "won";
  player: Coordinate;
  pencil: Record<string, string>;
  ink: Record<string, string>;
  hintedCellKeys: string[];
  solvedWordIds: string[];
  revealZones: RevealZone[];
  capturedCellKeys: string[];
  collectedObjectIds: string[];
  keysCollected: number;
  credits: number;
  creditsEarned: number;
  creditsSpent: number;
  simplifiedWordIds: string[];
  directionUsesRemaining: number;
  firstSolveRevealGranted: boolean;
  captures: number;
  itemsUsed: number;
  path: Coordinate[];
  activeMs: number;
  finishedAtActiveMs: number | null;
  lastFeedback: GameFeedback | null;
}

export type GameAction =
  | { type: "write-cell"; position: Coordinate; letter: string }
  | { type: "submit-word"; wordId: string }
  | { type: "move"; destination: Coordinate }
  | { type: "use-item"; item: ItemType; wordId?: string; position?: Coordinate }
  | { type: "add-active-time"; milliseconds: number };

export function createInitialGameState(map: DailyMap): GameState {
  return {
    schemaVersion: 2,
    mapId: map.id,
    mode: map.mode,
    status: "playing",
    player: { ...map.spawn },
    pencil: {},
    ink: {},
    hintedCellKeys: [],
    solvedWordIds: [],
    revealZones: [{ ...map.spawn, radius: GAME_BALANCE.fog.initialRadius, source: "initial" }],
    capturedCellKeys: [],
    collectedObjectIds: [],
    keysCollected: 0,
    credits: GAME_BALANCE.economy.initialCredits,
    creditsEarned: GAME_BALANCE.economy.initialCredits,
    creditsSpent: 0,
    simplifiedWordIds: [],
    directionUsesRemaining: 0,
    firstSolveRevealGranted: false,
    captures: 0,
    itemsUsed: 0,
    path: [{ ...map.spawn }],
    activeMs: 0,
    finishedAtActiveMs: null,
    lastFeedback: null,
  };
}

function wordTouchesPosition(word: PlacedWord, position: Coordinate): boolean {
  const key = coordinateKey(position);
  return cellsForWord(word).some((cell) => coordinateKey(cell) === key);
}

export function availableWords(map: DailyMap, state: GameState): PlacedWord[] {
  const solved = new Set(state.solvedWordIds);
  const solvedCells = new Set(
    map.words
      .filter((word) => solved.has(word.id))
      .flatMap((word) => cellsForWord(word).map(coordinateKey)),
  );
  return map.words.filter((word) => {
    if (solved.has(word.id)) return true;
    if (state.solvedWordIds.length === 0) return wordTouchesPosition(word, map.spawn);
    return cellsForWord(word).some((cell) => solvedCells.has(coordinateKey(cell)));
  });
}

export function isCoordinateRevealed(state: GameState, coordinate: Coordinate): boolean {
  if (state.capturedCellKeys.includes(coordinateKey(coordinate))) return true;
  return state.revealZones.some(
    (zone) => Math.abs(zone.x - coordinate.x) + Math.abs(zone.y - coordinate.y) <= zone.radius,
  );
}

function solvedCellGraph(map: DailyMap, state: GameState): Map<string, Set<string>> {
  const solved = new Set(state.solvedWordIds);
  const graph = new Map<string, Set<string>>();
  for (const word of map.words) {
    if (!solved.has(word.id)) continue;
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

function findPath(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  origin: Coordinate,
  destination: Coordinate,
): string[] | null {
  const originKey = coordinateKey(origin);
  const destinationKey = coordinateKey(destination);
  if (!graph.has(originKey) || !graph.has(destinationKey)) return null;
  const previous = new Map<string, string | null>([[originKey, null]]);
  const queue: string[] = [originKey];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    if (current === destinationKey) break;
    for (const neighbor of graph.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  if (!previous.has(destinationKey)) return null;
  const path: string[] = [];
  let cursor: string | null = destinationKey;
  while (cursor) {
    path.unshift(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return path;
}

function withCollectedObject(state: GameState, object: MapObject): GameState {
  if (state.collectedObjectIds.includes(object.id) || object.type === "exit") return state;
  const collectedObjectIds = [...state.collectedObjectIds, object.id];
  if (object.type === "key") {
    return {
      ...state,
      collectedObjectIds,
      keysCollected: state.keysCollected + 1,
      lastFeedback: { kind: "collected", message: "Uma chave foi encontrada.", subjectId: object.id },
    };
  }
  if (object.type !== "coin") return state;
  return {
    ...state,
    collectedObjectIds,
    credits: state.credits + object.value,
    creditsEarned: state.creditsEarned + object.value,
    lastFeedback: { kind: "collected", message: "Uma moeda foi recolhida.", subjectId: object.id },
  };
}

function captureEnclosedCells(map: DailyMap, state: GameState): GameState {
  const solved = new Set(state.solvedWordIds);
  const walls = new Set(
    map.words
      .filter((word) => solved.has(word.id))
      .flatMap((word) => cellsForWord(word).map(coordinateKey)),
  );
  if (walls.size < 8) return state;

  const minX = map.bounds.minX - 1;
  const minY = map.bounds.minY - 1;
  const maxX = map.bounds.maxX + 1;
  const maxY = map.bounds.maxY + 1;
  const outside = new Set<string>();
  const queue: Coordinate[] = [{ x: minX, y: minY }];
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    const key = coordinateKey(current);
    if (outside.has(key) || walls.has(key)) continue;
    if (current.x < minX || current.x > maxX || current.y < minY || current.y > maxY) continue;
    outside.add(key);
    for (const direction of directions) {
      queue.push({ x: current.x + direction.x, y: current.y + direction.y });
    }
  }

  const captured = new Set(state.capturedCellKeys);
  for (let y = minY + 1; y < maxY; y += 1) {
    for (let x = minX + 1; x < maxX; x += 1) {
      const key = coordinateKey({ x, y });
      if (!outside.has(key) && !walls.has(key)) captured.add(key);
    }
  }
  if (captured.size === state.capturedCellKeys.length) return state;

  const gained = captured.size - state.capturedCellKeys.length;
  const bonus = creditsForCapture(gained);
  let next: GameState = {
    ...state,
    capturedCellKeys: [...captured],
    captures: state.captures + 1,
    credits: state.credits + bonus,
    creditsEarned: state.creditsEarned + bonus,
  };
  for (const object of map.objects) {
    if (object.type !== "exit" && captured.has(coordinateKey(object.position))) {
      next = withCollectedObject(next, object);
    }
  }
  return next;
}

function submitWord(map: DailyMap, state: GameState, wordId: string): GameState {
  const word = map.words.find((candidate) => candidate.id === wordId);
  if (!word || state.solvedWordIds.includes(wordId)) return state;
  if (!availableWords(map, state).some((candidate) => candidate.id === wordId)) {
    return {
      ...state,
      lastFeedback: { kind: "unavailable", message: "Esse caminho ainda não toca sua rota.", subjectId: wordId },
    };
  }

  const guess = cellsForWord(word)
    .map((cell) => state.ink[coordinateKey(cell)] ?? state.pencil[coordinateKey(cell)] ?? "")
    .join("");
  if (guess !== word.gridAnswer) {
    return {
      ...state,
      lastFeedback: { kind: "incorrect", message: "Ainda não se encaixa.", subjectId: wordId },
    };
  }

  const ink = { ...state.ink };
  const pencil = { ...state.pencil };
  const revealZones = [...state.revealZones];
  for (const cell of cellsForWord(word)) {
    const key = coordinateKey(cell);
    ink[key] = cell.letter;
    delete pencil[key];
    revealZones.push({ x: cell.x, y: cell.y, radius: GAME_BALANCE.fog.solvedWordRadius, source: "word" });
  }
  const firstSolve = state.solvedWordIds.length === 0;
  if (firstSolve) {
    revealZones.push({ ...map.spawn, radius: GAME_BALANCE.fog.firstSolveRadius, source: "tutorial" });
  }

  let next: GameState = {
    ...state,
    pencil,
    ink,
    solvedWordIds: [...state.solvedWordIds, word.id],
    revealZones,
    credits: state.credits + creditsForWord(word),
    creditsEarned: state.creditsEarned + creditsForWord(word),
    firstSolveRevealGranted: state.firstSolveRevealGranted || firstSolve,
    directionUsesRemaining: Math.max(0, state.directionUsesRemaining - 1),
    lastFeedback: { kind: "correct", message: "O caminho ganhou tinta.", subjectId: word.id },
  };
  next = captureEnclosedCells(map, next);
  return next;
}

function finishIfExit(map: DailyMap, state: GameState, positionKey: string): GameState {
  const exit = map.objects.find(
    (object) => object.type === "exit" && coordinateKey(object.position) === positionKey,
  );
  if (map.objective.kind !== "keys-and-exit") return state;
  if (!exit || state.keysCollected < map.objective.keysRequired) return state;
  return {
    ...state,
    player: { ...exit.position },
    status: "won",
    finishedAtActiveMs: state.activeMs,
    lastFeedback: { kind: "correct", message: "O Cruzaverso de hoje foi desbravado.", subjectId: exit.id },
  };
}

function move(map: DailyMap, state: GameState, destination: Coordinate): GameState {
  const path = findPath(solvedCellGraph(map, state), state.player, destination);
  if (!path) {
    return {
      ...state,
      lastFeedback: { kind: "blocked", message: "Resolva um caminho até lá primeiro." },
    };
  }

  let next = state;
  for (const key of path.slice(1)) {
    const player = parseCoordinateKey(key);
    next = { ...next, player, path: [...next.path, player] };
    for (const object of map.objects) {
      if (coordinateKey(object.position) === key) next = withCollectedObject(next, object);
    }
    next = finishIfExit(map, next, key);
    if (next.status === "won") return next;
  }
  return next;
}

function wordsCoveringPosition(
  map: DailyMap,
  state: GameState,
  position: Coordinate,
): PlacedWord[] {
  const available = new Set(availableWords(map, state).map((word) => word.id));
  const key = coordinateKey(position);
  return map.words.filter(
    (word) =>
      available.has(word.id) &&
      !state.solvedWordIds.includes(word.id) &&
      cellsForWord(word).some((cell) => coordinateKey(cell) === key),
  );
}

function useItem(
  map: DailyMap,
  state: GameState,
  action: Extract<GameAction, { type: "use-item" }>,
): GameState {
  const price = priceOf(action.item);
  if (state.credits < price) return state;
  const paid = {
    credits: state.credits - price,
    creditsSpent: state.creditsSpent + price,
    itemsUsed: state.itemsUsed + 1,
  };

  if (action.item === "reveal-area") {
    if (!action.position) return state;
    return {
      ...state,
      ...paid,
      revealZones: [
        ...state.revealZones,
        { ...action.position, radius: GAME_BALANCE.fog.revealAreaRadius, source: "item" },
      ],
    };
  }

  if (action.item === "objective-direction") {
    return {
      ...state,
      ...paid,
      directionUsesRemaining: GAME_BALANCE.objectiveDirectionSolvedWords,
    };
  }

  if (action.item === "simplify-clue") {
    const word = map.words.find((candidate) => candidate.id === action.wordId);
    if (!word) return state;
    if (state.simplifiedWordIds.includes(word.id)) return state;
    if (!availableWords(map, state).some((candidate) => candidate.id === word.id)) return state;
    if (state.solvedWordIds.includes(word.id)) return state;
    return { ...state, ...paid, simplifiedWordIds: [...state.simplifiedWordIds, word.id] };
  }

  if (!action.position) return state;
  const key = coordinateKey(action.position);
  if (state.ink[key]) return state;
  const word = wordsCoveringPosition(map, state, action.position)[0];
  if (!word) return state;
  const cell = cellsForWord(word).find((candidate) => coordinateKey(candidate) === key);
  if (!cell) return state;
  const pencil = { ...state.pencil };
  delete pencil[key];
  const next: GameState = {
    ...state,
    ...paid,
    pencil,
    ink: { ...state.ink, [key]: cell.letter },
    hintedCellKeys: [...state.hintedCellKeys, key],
  };
  return automaticallyCheckFilledWords(map, next, cell);
}

function automaticallyCheckFilledWords(
  map: DailyMap,
  state: GameState,
  position: Coordinate,
): GameState {
  let next = state;
  const candidates = map.words.filter(
    (word) =>
      !next.solvedWordIds.includes(word.id) &&
      wordTouchesPosition(word, position) &&
      availableWords(map, next).some((available) => available.id === word.id),
  );
  for (const word of candidates) {
    const isFilled = cellsForWord(word).every(
      (cell) => Boolean(next.ink[coordinateKey(cell)] ?? next.pencil[coordinateKey(cell)]),
    );
    if (isFilled) next = submitWord(map, next, word.id);
  }
  return next;
}

export function applyGameAction(map: DailyMap, state: GameState, action: GameAction): GameState {
  if (action.type === "add-active-time") {
    if (state.status === "won") return state;
    return { ...state, activeMs: state.activeMs + Math.max(0, action.milliseconds) };
  }
  if (state.status === "won") return state;
  if (action.type === "submit-word") return submitWord(map, state, action.wordId);
  if (action.type === "move") return move(map, state, action.destination);
  if (action.type === "use-item") return useItem(map, state, action);

  const key = coordinateKey(action.position);
  if (state.ink[key]) return state;
  const letter = normalizeGridAnswer(action.letter).slice(-1);
  const pencil = { ...state.pencil };
  if (letter) pencil[key] = letter;
  else delete pencil[key];
  return automaticallyCheckFilledWords(
    map,
    { ...state, pencil, lastFeedback: null },
    action.position,
  );
}

export function objectiveDirection(map: DailyMap, state: GameState): Coordinate | null {
  if (state.directionUsesRemaining <= 0) return null;
  const targets =
    map.objective.kind === "sandbox"
      ? map.objects.filter(
          (object) => object.type === "coin" && !state.collectedObjectIds.includes(object.id),
        )
      : state.keysCollected >= map.objective.keysRequired
        ? map.objects.filter((object) => object.type === "exit")
        : map.objects.filter(
            (object) => object.type === "key" && !state.collectedObjectIds.includes(object.id),
          );
  const nearest = [...targets].sort((left, right) => {
    const leftDistance =
      Math.abs(left.position.x - state.player.x) + Math.abs(left.position.y - state.player.y);
    const rightDistance =
      Math.abs(right.position.x - state.player.x) + Math.abs(right.position.y - state.player.y);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
  if (!nearest) return null;
  return {
    x: Math.sign(nearest.position.x - state.player.x),
    y: Math.sign(nearest.position.y - state.player.y),
  };
}
