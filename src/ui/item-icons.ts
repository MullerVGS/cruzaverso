import type { ItemType } from "../generation/types.js";

/**
 * Um desenho por item, numa caixa 24×24, usado no mesmo tamanho na loja, no
 * aviso de armado e no cursor do sistema. É o que liga o botão comprado ao
 * ponteiro que o jogador leva até o alvo.
 */
export const ITEM_ART: Record<ItemType, string[]> = {
  // Lupa sobre uma letra.
  "reveal-letter": [
    "M9.5 14.5 12 7l2.5 7.5M10.4 12.3h3.2",
    "M12 3a9 9 0 1 0 .01 18A9 9 0 0 0 12 3",
    "M18.4 18.6 23 23.4",
  ],
  // Pergaminho com três linhas de texto refeitas.
  "simplify-clue": [
    "M4 5.5q4-2 8 0t8 0v13q-4 2-8 0t-8 0z",
    "M7.4 10.2q4.6-1.6 9.2 0",
    "M7.4 13.4q4.6-1.6 9.2 0",
    "M7.4 16.6q3 -1.1 6 0",
  ],
  // Luneta: tubo levemente cônico, inclinado, com dois anéis de corpo.
  // Desenhada na horizontal e com muita abertura, a forma lia como megafone;
  // a inclinação e o afunilamento discreto (1,8:1) é que a fazem ler luneta.
  "reveal-area": ["M6.5 20.7 3.5 17.3 16.2 2.8l5.6 6.4z", "M14.1 15 9.9 10", "M8.4 19.2 5 15.4"],
  // Bússola com agulha.
  "objective-direction": [
    "M12 2.4a9.6 9.6 0 1 0 .01 19.2A9.6 9.6 0 0 0 12 2.4",
    "M16.4 7.6 13.8 13.8 7.6 16.4 10.2 10.2z",
    "M12 5.6v1.8M12 16.6v1.8M5.6 12h1.8M16.6 12h1.8",
  ],
};
