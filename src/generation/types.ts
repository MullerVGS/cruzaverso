import type { BiomeId } from "../content/catalog.js";
import type { BiomeFieldSpec } from "./biome-field.js";

export interface Coordinate {
  x: number;
  y: number;
}

export type CoordinateKey = `${number},${number}`;

export type Orientation = "horizontal" | "vertical";

export interface BiomeSite extends Coordinate {
  id: string;
  biome: BiomeId;
  radius: number;
}

export interface WorldChunk extends Coordinate {
  id: string;
  biome: BiomeId;
  neighbors: string[];
}

export interface PlacedWord {
  id: string;
  entryId: string;
  answer: string;
  gridAnswer: string;
  clues: {
    normal: string;
    simple: string;
  };
  difficulty: number;
  familiarity: number;
  biome: BiomeId;
  orientation: Orientation;
  start: Coordinate;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GenerationReport {
  valid: boolean;
  attempt: number;
  requestedWords: number;
  placedWords: number;
  crossings: number;
  cycles: number;
  score: number;
  errors: string[];
}

export interface DailyWorld {
  schemaVersion: 2;
  generatorVersion: string;
  datasetVersion: string;
  configVersion: string;
  id: string;
  date: string;
  seed: string;
  biomeSites: BiomeSite[];
  biomeField: BiomeFieldSpec;
  chunks: WorldChunk[];
  words: PlacedWord[];
  bounds: Bounds;
  report: GenerationReport;
  candidateReports: GenerationReport[];
}

export type PowerupType =
  | "reveal-letter"
  | "simplify-clue"
  | "reveal-area"
  | "objective-direction";

export type MapObject =
  | {
      id: string;
      type: "key" | "exit";
      position: Coordinate;
    }
  | {
      id: string;
      type: "powerup";
      powerupType: PowerupType;
      position: Coordinate;
    };

export interface DailyMapReport {
  valid: boolean;
  words: number;
  crossings: number;
  cycles: number;
  biomes: number;
  score: number;
  routeDiversity: number;
  mandatoryWords: number;
  routePlans: Array<{
    keyIds: [string, string];
    requiredWords: string[];
  }>;
  candidateReports: Array<{
    spawn: Coordinate;
    words: number;
    cycles: number;
    routeDiversity: number;
    mandatoryWords: number;
    score: number;
  }>;
  errors: string[];
}

export interface DailyMap {
  schemaVersion: 2;
  id: string;
  worldId: string;
  configVersion: string;
  date: string;
  seed: string;
  size: "medium";
  biomeSites: BiomeSite[];
  biomeField: BiomeFieldSpec;
  words: PlacedWord[];
  bounds: Bounds;
  spawn: Coordinate;
  objects: MapObject[];
  objective: {
    keysRequired: 2;
    keysAvailable: 3;
  };
  report: DailyMapReport;
}

export function cellsForWord(word: Pick<PlacedWord, "gridAnswer" | "orientation" | "start">) {
  return [...word.gridAnswer].map((letter, index) => ({
    x: word.start.x + (word.orientation === "horizontal" ? index : 0),
    y: word.start.y + (word.orientation === "vertical" ? index : 0),
    letter,
    index,
  }));
}

export function coordinateKey(coordinate: Coordinate): CoordinateKey {
  return `${coordinate.x},${coordinate.y}`;
}

export function parseCoordinateKey(key: string): Coordinate {
  const [x, y] = key.split(",").map(Number);
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) {
    throw new Error(`Coordenada inválida: ${key}`);
  }
  return { x, y };
}
