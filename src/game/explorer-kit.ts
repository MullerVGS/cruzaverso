import { NEEDLE_IDS, type NeedleId } from "../config/game.js";
import type { Coordinate, MapMode } from "../generation/types.js";

/**
 * O que o explorador carrega entre expedições. É a única coisa do jogo que
 * atravessa runs, e é cosmética de propósito: a bússola não conta nada que o
 * mapa já não conte.
 */
export interface ExplorerKit {
  compassUnlocked: boolean;
  compassEquipped: boolean;
  needle: NeedleId;
}

export const DEFAULT_EXPLORER_KIT: ExplorerKit = {
  compassUnlocked: false,
  compassEquipped: false,
  needle: "seta-rumo",
};

function isNeedleId(value: unknown): value is NeedleId {
  return typeof value === "string" && (NEEDLE_IDS as string[]).includes(value);
}

/** Tolerante por dever: é conteúdo de localStorage, não um contrato de rede. */
export function parseExplorerKit(raw: string | null): ExplorerKit {
  if (!raw) return DEFAULT_EXPLORER_KIT;
  try {
    const parsed = JSON.parse(raw) as Partial<ExplorerKit>;
    const compassUnlocked = parsed.compassUnlocked === true;
    return {
      compassUnlocked,
      // Equipar sem ter conquistado não existe: o estado salvo não pode
      // conceder o que a conquista concede.
      compassEquipped: compassUnlocked && parsed.compassEquipped === true,
      needle: isNeedleId(parsed.needle) ? parsed.needle : DEFAULT_EXPLORER_KIT.needle,
    };
  } catch {
    return DEFAULT_EXPLORER_KIT;
  }
}

export function serializeExplorerKit(kit: ExplorerKit): string {
  return JSON.stringify(kit);
}

/** Conquistar equipa: o prêmio precisa aparecer no mapa sem passar por menu. */
export function unlockCompass(kit: ExplorerKit): ExplorerKit {
  if (kit.compassUnlocked) return kit;
  return { ...kit, compassUnlocked: true, compassEquipped: true };
}

export function equipCompass(kit: ExplorerKit, equipped: boolean): ExplorerKit {
  if (!kit.compassUnlocked) return kit;
  if (kit.compassEquipped === equipped) return kit;
  return { ...kit, compassEquipped: equipped };
}

export function chooseNeedle(kit: ExplorerKit, needle: NeedleId): ExplorerKit {
  if (!kit.compassUnlocked || kit.needle === needle) return kit;
  return { ...kit, needle };
}

/**
 * A conquista da bússola: concluir uma expedição diária. Vale o arquivo, porque
 * uma edição passada é uma expedição diária como qualquer outra; não vale o modo
 * livre, que não tem fim.
 */
export function unlocksCompass(mode: MapMode, status: "playing" | "won"): boolean {
  return mode === "daily" && status === "won";
}

/**
 * Rumo da agulha em graus, com zero no norte da carta. Recebe o mesmo vetor de
 * sinais que a Bússola da loja já entrega — a agulha é outro mostrador para a
 * mesma informação, nunca uma informação a mais.
 */
export function needleBearing(direction: Coordinate | null): number {
  if (!direction || (direction.x === 0 && direction.y === 0)) return 0;
  return (Math.atan2(direction.x, -direction.y) * 180) / Math.PI;
}
