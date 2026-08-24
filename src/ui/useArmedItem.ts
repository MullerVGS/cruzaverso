import { useCallback, useEffect, useState } from "react";

import { ITEM_DEFINITIONS } from "../config/game.js";
import type { ItemType } from "../generation/types.js";
import { ITEM_ART } from "./item-icons.js";

/**
 * O ponteiro do sistema vira uma seta comum com o glifo do item ao lado.
 * Desenhar um cursor falso dentro da página atrasa em relação ao ponteiro real
 * e o jogador vê dois.
 *
 * As cores vão com `#` literal: escrevê-las já escapadas (`%23`) e passar tudo
 * por `encodeURIComponent` produz `%2523`, cor inválida que o SVG descarta para
 * o preto padrão — era isso que deixava o cursor como um disco preto.
 */
function cursorFor(item: ItemType): string {
  const glifo = ITEM_ART[item].map((path) => `<path d="${path}"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">` +
    `<path d="M2 2 2 20.5 7.1 15.6 10.4 22.6 13.6 21.1 10.3 14.3 16.8 13.7z"` +
    ` fill="#1b211f" stroke="#faf2dc" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<g transform="translate(16 14) scale(.76)" fill="none"` +
    ` stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#faf2dc" stroke-width="5.5">${glifo}</g>` +
    `<g stroke="#1b211f" stroke-width="2">${glifo}</g>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`;
}

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
