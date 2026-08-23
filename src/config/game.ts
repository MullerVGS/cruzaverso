import type { BiomeId } from "../content/catalog.js";
import type { PowerupType } from "../generation/types.js";

export const GAME_BALANCE = {
  world: {
    targetWords: 58,
    attempts: 7,
    chunkCount: 22,
  },
  medium: {
    targetWords: { minInclusive: 20, maxExclusive: 27 },
    powerups: { minInclusive: 4, maxExclusive: 7 },
    keysAvailable: 3,
    keysRequired: 2,
  },
  fog: {
    initialRadius: 3,
    solvedWordRadius: 2,
    firstSolveRadius: 10,
    revealAreaPowerupRadius: 8,
  },
  objectiveDirectionSolvedWords: 3,
  activeTimeIdleAfterMs: 45_000,
} as const;

export const BIOME_DEFINITIONS: Record<
  BiomeId,
  { label: string; color: string; symbol: string; description: string }
> = {
  cotidiano: {
    label: "Cotidiano",
    color: "#758c68",
    symbol: "⌂",
    description: "Objetos, hábitos e encontros do dia a dia.",
  },
  ciencia: {
    label: "Ciência",
    color: "#5583a2",
    symbol: "⌬",
    description: "Natureza, matéria, vida e descobertas.",
  },
  historia: {
    label: "História",
    color: "#b1814e",
    symbol: "⌛",
    description: "Povos, épocas, instituições e vestígios.",
  },
  "cultura-pop": {
    label: "Cultura Pop",
    color: "#a8616c",
    symbol: "✦",
    description: "Cinema, jogos, quadrinhos e cultura de rede.",
  },
};

export const POWERUP_DEFINITIONS: Record<
  PowerupType,
  {
    icon: string;
    name: string;
    description: string;
    spawnWeight: number;
    effect: Record<string, number | string>;
  }
> = {
  "reveal-letter": {
    icon: "A·",
    name: "Letra encontrada",
    description: "Revela uma letra da pista aberta.",
    spawnWeight: 1.15,
    effect: { letters: 1 },
  },
  "simplify-clue": {
    icon: "≋",
    name: "Outra pista",
    description: "Troca a pista atual por uma versão mais direta.",
    spawnWeight: 0.9,
    effect: { clueTier: "simple" },
  },
  "reveal-area": {
    icon: "◉",
    name: "Luneta",
    description: "Abre uma área grande ao redor do explorador.",
    spawnWeight: 0.85,
    effect: { radius: GAME_BALANCE.fog.revealAreaPowerupRadius },
  },
  "objective-direction": {
    icon: "➶",
    name: "Bússola",
    description: "Aponta a direção aproximada do próximo objetivo.",
    spawnWeight: 0.7,
    effect: { solvedWords: GAME_BALANCE.objectiveDirectionSolvedWords },
  },
};
