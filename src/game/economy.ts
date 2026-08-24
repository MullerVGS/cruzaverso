import { GAME_BALANCE, ITEM_DEFINITIONS } from "../config/game.js";
import type { ItemType, PlacedWord } from "../generation/types.js";

export function creditsForWord(word: Pick<PlacedWord, "gridAnswer">): number {
  return word.gridAnswer.length * GAME_BALANCE.economy.creditsPerLetter;
}

export function creditsForCapture(newlyCapturedCells: number): number {
  if (newlyCapturedCells <= 0) return 0;
  const raw = Math.ceil(newlyCapturedCells * GAME_BALANCE.economy.captureCreditsPerCell);
  return Math.min(raw, GAME_BALANCE.economy.captureCreditsCap);
}

export function priceOf(item: ItemType): number {
  return ITEM_DEFINITIONS[item].price;
}

export function canAfford(credits: number, item: ItemType): boolean {
  return credits >= priceOf(item);
}
