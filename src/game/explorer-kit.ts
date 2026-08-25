import {
  EXPLORER,
  INITIAL_NEEDLE,
  NEEDLE_IDS,
  type NeedleId,
  type NeedleUnlock,
} from "../config/game.js";
import type { Coordinate, MapMode } from "../generation/types.js";

/**
 * O que o explorador carrega entre expedições. É a única coisa do jogo que
 * atravessa runs, e é cosmética de propósito: a bússola não conta nada que o
 * mapa já não conte.
 *
 * O aro vem no kit desde o primeiro passo — só a agulha se conquista. Por isso
 * `compassEquipped` é preferência de quem joga, não estado de bloqueio: quem
 * prefere o marcador simples desliga o instrumento e segue com ele desligado.
 */
export interface ExplorerKit {
  compassEquipped: boolean;
  needle: NeedleId;
  unlockedNeedles: NeedleId[];
}

export const DEFAULT_EXPLORER_KIT: ExplorerKit = {
  compassEquipped: true,
  needle: INITIAL_NEEDLE,
  unlockedNeedles: [INITIAL_NEEDLE],
};

function isNeedleId(value: unknown): value is NeedleId {
  return typeof value === "string" && (NEEDLE_IDS as string[]).includes(value);
}

/**
 * A ordem do catálogo manda na lista guardada, e a inicial nunca falta: assim
 * o painel não muda de ordem conforme a sequência em que os marcos caíram.
 */
function normalizeNeedles(values: readonly unknown[]): NeedleId[] {
  const wanted = new Set([INITIAL_NEEDLE, ...values.filter(isNeedleId)]);
  return NEEDLE_IDS.filter((needle) => wanted.has(needle));
}

/** Tolerante por dever: é conteúdo de localStorage, não um contrato de rede. */
export function parseExplorerKit(raw: string | null): ExplorerKit {
  if (!raw) return DEFAULT_EXPLORER_KIT;
  try {
    const parsed = JSON.parse(raw) as Partial<ExplorerKit> & { compassUnlocked?: unknown };
    // Modelo antigo: a bússola inteira era a conquista e chegava com as três
    // agulhas juntas. Quem já a tinha fica com todas — retirar a agulha que o
    // veterano usa hoje seria uma regressão visível.
    const legacyAll = parsed.compassUnlocked === true;
    const unlockedNeedles = legacyAll
      ? [...NEEDLE_IDS]
      : normalizeNeedles(Array.isArray(parsed.unlockedNeedles) ? parsed.unlockedNeedles : []);
    const needle =
      isNeedleId(parsed.needle) && unlockedNeedles.includes(parsed.needle)
        ? parsed.needle
        : DEFAULT_EXPLORER_KIT.needle;
    return {
      compassEquipped: parsed.compassEquipped !== false,
      needle,
      unlockedNeedles,
    };
  } catch {
    return DEFAULT_EXPLORER_KIT;
  }
}

export function serializeExplorerKit(kit: ExplorerKit): string {
  return JSON.stringify(kit);
}

export function equipCompass(kit: ExplorerKit, equipped: boolean): ExplorerKit {
  if (kit.compassEquipped === equipped) return kit;
  return { ...kit, compassEquipped: equipped };
}

export function chooseNeedle(kit: ExplorerKit, needle: NeedleId): ExplorerKit {
  if (!kit.unlockedNeedles.includes(needle) || kit.needle === needle) return kit;
  return { ...kit, needle };
}

/**
 * Conquistar veste: o prêmio precisa aparecer no mapa sem passar por menu — e
 * o instrumento volta ligado, senão a agulha nova chega invisível.
 */
export function grantNeedle(kit: ExplorerKit, needle: NeedleId): ExplorerKit {
  if (kit.unlockedNeedles.includes(needle)) return kit;
  return {
    compassEquipped: true,
    needle,
    unlockedNeedles: normalizeNeedles([...kit.unlockedNeedles, needle]),
  };
}

/**
 * Qual marco cada modo cumpre ao ser concluído. É um mapa exaustivo e não um
 * ternário de propósito: um modo novo passa a exigir uma decisão explícita
 * aqui, em vez de herdar o prêmio do livre em silêncio.
 */
const UNLOCK_BY_MODE: Record<MapMode, NeedleUnlock> = {
  daily: "daily-win",
  free: "free-win",
};

/**
 * O marco de cada agulha: concluir uma expedição diária dá uma, concluir uma
 * expedição livre dá a outra. O requisito mora no catálogo de agulhas, então
 * uma agulha nova entra pela arte e não por uma regra escrita aqui.
 */
export function needleEarnedBy(mode: MapMode, status: "playing" | "won"): NeedleId | null {
  if (status !== "won") return null;
  const unlock = UNLOCK_BY_MODE[mode];
  return EXPLORER.needles.find((needle) => needle.unlock === unlock)?.id ?? null;
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
