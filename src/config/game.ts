import type { BiomeId } from "../content/catalog.js";
import type { ItemType } from "../generation/types.js";

export const GAME_BALANCE = {
  world: {
    targetWords: 84,
    attempts: 4,
    chunkCount: 28,
    anchorScanLimit: 32,
    entriesPerAnchor: 36,
    optionsPerPlacement: 80,
  },
  medium: {
    targetWords: { minInclusive: 28, maxExclusive: 35 },
    coins: { minInclusive: 5, maxExclusive: 9 },
    keysAvailable: 3,
    keysRequired: 2,
  },
  fog: {
    initialRadius: 3,
    solvedWordRadius: 2,
    firstSolveRadius: 10,
  },
  objectiveDirectionSolvedWords: 3,
  activeTimeIdleAfterMs: 45_000,
  economy: {
    // O estipêndio é o único crédito que existe antes da primeira palavra, e é
    // exatamente ali que o jogador trava: 25 paga duas ajudas em vez de uma,
    // sem mexer no meio do jogo, onde o crédito já sobra.
    initialCredits: 25,
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
    description: "Células, matéria, números e descobertas.",
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
  natureza: {
    label: "Natureza",
    color: "#4f8068",
    symbol: "❧",
    description: "Fauna, flora, paisagens e ciclos do mundo natural.",
  },
  brasil: {
    label: "Brasil",
    color: "#b08a3f",
    symbol: "◆",
    description: "Territórios, culturas e modos de viver brasileiros.",
  },
};

export const ITEM_DEFINITIONS: Record<
  ItemType,
  {
    icon: string;
    name: string;
    description: string;
    price: number;
    targeting: "cell" | "word" | "route" | "instant";
  }
> = {
  "reveal-letter": {
    icon: "A·",
    name: "Letra encontrada",
    description: "Revela uma letra de uma palavra aberta.",
    // Abaixo da média de 7,2 letras do catálogo, comprar letra passa a se pagar
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
  "unlock-route": {
    icon: "◉",
    name: "Luneta",
    description: "Libera uma rota avistada para ser resolvida, mesmo longe da sua trilha.",
    // O item mais forte da loja: a rota liberada rende as letras dela e ainda
    // estende a fronteira. Acima da média de 7,2 letras, a compra segue no
    // prejuízo direto e não vira torneira de crédito.
    price: 20,
    targeting: "route",
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
