import type { BiomeId } from "../content/catalog.js";
import type { ItemType } from "../generation/types.js";

export const GAME_BALANCE = {
  world: {
    targetWords: 58,
    attempts: 7,
    chunkCount: 22,
  },
  medium: {
    targetWords: { minInclusive: 20, maxExclusive: 27 },
    coins: { minInclusive: 5, maxExclusive: 9 },
    keysAvailable: 3,
    keysRequired: 2,
  },
  fog: {
    initialRadius: 3,
    solvedWordRadius: 2,
    firstSolveRadius: 10,
    revealAreaRadius: 8,
  },
  objectiveDirectionSolvedWords: 3,
  activeTimeIdleAfterMs: 45_000,
  economy: {
    initialCredits: 15,
    creditsPerLetter: 1,
    captureCreditsPerCell: 0.5,
    captureCreditsCap: 30,
    coinValue: 12,
  },
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

export const ITEM_DEFINITIONS: Record<
  ItemType,
  {
    icon: string;
    name: string;
    description: string;
    price: number;
    targeting: "cell" | "word" | "map" | "instant";
  }
> = {
  "reveal-letter": {
    icon: "A·",
    name: "Letra encontrada",
    description: "Revela uma letra de uma palavra aberta.",
    // Abaixo da média de 7,3 letras do catálogo, comprar letra passa a se pagar
    // com o crédito da própria palavra e a loja vira crédito infinito.
    price: 10,
    targeting: "cell",
  },
  "simplify-clue": {
    icon: "≋",
    name: "Outra pista",
    description: "Abre uma segunda pista, mais direta, sem apagar a original.",
    price: 14,
    targeting: "word",
  },
  "reveal-area": {
    icon: "◉",
    name: "Luneta",
    description: "Abre uma área grande onde você escolher.",
    price: 18,
    targeting: "map",
  },
  "objective-direction": {
    icon: "➶",
    name: "Bússola",
    description: "Aponta a direção aproximada do próximo objetivo.",
    price: 22,
    targeting: "instant",
  },
};

export const ITEM_TYPES = Object.keys(ITEM_DEFINITIONS) as ItemType[];
