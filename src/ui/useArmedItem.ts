import { useCallback, useEffect, useState } from "react";

import { ITEM_DEFINITIONS } from "../config/game.js";
import type { ItemType } from "../generation/types.js";
import { ITEM_ART } from "./item-icons.js";

/**
 * O ponteiro do sistema vira o glifo do item. Desenhar um cursor falso dentro
 * da página atrasa em relação ao ponteiro real e o jogador vê dois.
 *
 * O `#` das cores vem escrito como `%23`: cru, ele encerra o data-URI.
 */
function cursorFor(item: ItemType): string {
  const paths = ITEM_ART[item].map((path) => `<path d="${path}"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="-3 -3 30 30">` +
    `<circle cx="12" cy="12" r="14" fill="%23faf2dc" stroke="%23293431" stroke-width="1.2"/>` +
    `<g fill="none" stroke="%23293431" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 15 15, crosshair`;
}

/**
 * Armar é estado de interface, nunca de jogo: o crédito só sai da carteira
 * quando o item aplica, então cancelar é reembolso por construção.
 */
export function useArmedItem() {
  const [armed, setArmed] = useState<ItemType | null>(null);

  const disarm = useCallback(() => setArmed(null), []);

  const arm = useCallback((item: ItemType) => {
    setArmed((current) => (current === item ? null : item));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!armed) {
      root.style.removeProperty("cursor");
      delete root.dataset.armedItem;
      return;
    }
    root.style.setProperty("cursor", cursorFor(armed));
    root.dataset.armedItem = armed;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setArmed(null);
    };
    const cancelOnContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setArmed(null);
    };
    window.addEventListener("keydown", cancelOnEscape);
    window.addEventListener("contextmenu", cancelOnContextMenu);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape);
      window.removeEventListener("contextmenu", cancelOnContextMenu);
      root.style.removeProperty("cursor");
      delete root.dataset.armedItem;
    };
  }, [armed]);

  return {
    armed,
    arm,
    disarm,
    targeting: armed ? ITEM_DEFINITIONS[armed].targeting : null,
  };
}
