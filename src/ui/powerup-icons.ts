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
    // Luneta de duas seções.
    full: ["M3.2 9.6 9 7.4v9.2l-5.8-2.2z", "M9 7.4 16.4 4.6v14.8L9 16.6z", "M16.4 6.2 21.6 4.2v15.6l-5.2-2z"],
    mark: ["M.8 5 4.4 3.6v6.8L.8 9z", "M4.4 3.6 9.4 1.7v10.6L4.4 10.4z"],
  },
  "objective-direction": {
    // Bússola com agulha.
    full: ["M12 2.4a9.6 9.6 0 1 0 .01 19.2A9.6 9.6 0 0 0 12 2.4", "M15.8 8.2 13 13l-4.8 2.8L11 11z", "M12 5.6v1.8M12 16.6v1.8M5.6 12h1.8M16.6 12h1.8"],
    mark: ["M7 .7a6.3 6.3 0 1 0 .01 12.6A6.3 6.3 0 0 0 7 .7", "M9.6 4.4 8 7.1 5.3 8.7 6.9 6z"],
  },
};
