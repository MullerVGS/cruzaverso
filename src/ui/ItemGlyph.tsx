import type { ItemType } from "../generation/types.js";
import { ITEM_ART } from "./item-icons.js";

interface ItemGlyphProps {
  item: ItemType;
  size?: number;
  className?: string;
}

/**
 * O mesmo desenho na loja, no aviso de armado e no cursor. Sem isso o jogador
 * compra um glifo e leva outro até o alvo.
 */
export function ItemGlyph({ item, size = 22, className = "" }: ItemGlyphProps) {
  return (
    <svg
      className={`item-glyph ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {ITEM_ART[item].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}
