import type { PowerupType } from "../generation/types.js";
import { POWERUP_ART } from "./powerup-icons.js";

interface PowerupGlyphProps {
  powerupType: PowerupType;
  size?: number;
  className?: string;
}

/**
 * O mesmo desenho que aparece no mapa, reutilizado na mochila e no tooltip.
 * Sem isso o jogador vê um glifo de texto no inventário e um ícone desenhado
 * no chão, e não liga uma coisa à outra.
 */
export function PowerupGlyph({ powerupType, size = 22, className = "" }: PowerupGlyphProps) {
  return (
    <svg
      className={`powerup-glyph ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {POWERUP_ART[powerupType].full.map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}
