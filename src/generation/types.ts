import type { BiomeId } from "../content/catalog.js";

export interface Coordinate {
  x: number;
  y: number;
}

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
  schemaVersion: 1;
  generatorVersion: string;
  datasetVersion: string;
  id: string;
  date: string;
  seed: string;
  biomeSites: BiomeSite[];
  chunks: WorldChunk[];
  words: PlacedWord[];
  bounds: Bounds;
  report: GenerationReport;
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
  errors: string[];
}

export interface DailyMap {
  schemaVersion: 1;
  id: string;
  worldId: string;
  date: string;
  seed: string;
  size: "medium";
  biomeSites: BiomeSite[];
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

export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}
