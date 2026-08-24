import type { PowerupType } from "../generation/types.js";

/**
 * Dois tamanhos por powerup. `full` ocupa a célula inteira (caixa 24×24) e
 * `mark` é a silhueta que ainda lê a 10px, no selo de canto. Não dá para
 * reduzir `full` e esperar leitura: a 10px só o contorno sobrevive.
 */
export const POWERUP_ART: Record<PowerupType, { full: string[]; mark: string[] }> = {
  "reveal-letter": {
    // Lupa sobre uma letra.
    full: ["M9.5 14.5 12 7l2.5 7.5M10.4 12.3h3.2", "M12 3a9 9 0 1 0 .01 18A9 9 0 0 0 12 3", "M18.4 18.6 23 23.4"],
    mark: ["M5 8 7 2.4 9 8M5.9 6.3h2.2", "M7 .8a6.2 6.2 0 1 0 .01 12.4A6.2 6.2 0 0 0 7 .8"],
  },
  "simplify-clue": {
    // Pergaminho com três linhas de texto refeitas.
    full: ["M4 5.5q4-2 8 0t8 0v13q-4 2-8 0t-8 0z", "M7.4 10.2q4.6-1.6 9.2 0", "M7.4 13.4q4.6-1.6 9.2 0", "M7.4 16.6q3 -1.1 6 0"],
    mark: ["M1.4 2.6q3-1.5 6 0t6 0v8.8q-3 1.5-6 0t-6 0z", "M4 6.4q3.5-1.2 7 0"],
  },
  "reveal-area": {
    // Luneta: tubo levemente cônico, inclinado, com dois anéis de corpo.
    // Desenhada na horizontal e com muita abertura, a forma lia como megafone;
    // a inclinação e o afunilamento discreto (1,8:1) é que a fazem ler luneta.
    full: [
      "M6.5 20.7 3.5 17.3 16.2 2.8l5.6 6.4z",
      "M14.1 15 9.9 10",
      "M8.4 19.2 5 15.4",
    ],
    mark: ["M3.8 12.1 2 10.1 9.5 1.7l3.2 3.6z", "M8.2 8.7 5.7 5.9"],
  },
  "objective-direction": {
    // Bússola com agulha.
    full: ["M12 2.4a9.6 9.6 0 1 0 .01 19.2A9.6 9.6 0 0 0 12 2.4", "M16.4 7.6 13.8 13.8 7.6 16.4 10.2 10.2z", "M12 5.6v1.8M12 16.6v1.8M5.6 12h1.8M16.6 12h1.8"],
    mark: ["M7 .7a6.3 6.3 0 1 0 .01 12.6A6.3 6.3 0 0 0 7 .7", "M9.6 4.4 8 7.1 5.3 8.7 6.9 6z"],
  },
};
