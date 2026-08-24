import { useState } from "react";

import { ITEM_DEFINITIONS, ITEM_TYPES } from "../config/game.js";
import type { ItemType } from "../generation/types.js";
import { ItemGlyph } from "./ItemGlyph.js";
import { SketchFrame } from "./SketchFrame.js";

interface ShopProps {
  credits: number;
  armed: ItemType | null;
  disabled: boolean;
  onArm: (item: ItemType) => void;
  onUseInstant: (item: ItemType) => void;
}

export function Shop({ credits, armed, disabled, onArm, onUseInstant }: ShopProps) {
  const [confirming, setConfirming] = useState<ItemType | null>(null);
  // Pré-visualização do saldo: o crédito ainda não saiu, e o jogador precisa
  // ver quanto sobraria antes de escolher o alvo.
  const preview = armed ? credits - ITEM_DEFINITIONS[armed].price : null;

  return (
    <section className="shop">
      <div className="shop-heading">
        <span>LOJA</span>
        <b className="wallet" aria-label={`${credits} créditos`}>
          ⬡ {credits}
          {preview !== null ? <i> → {preview}</i> : null}
        </b>
      </div>
      <div className="shop-grid">
        {ITEM_TYPES.map((item) => {
          const meta = ITEM_DEFINITIONS[item];
          const broke = credits < meta.price;
          return (
            <div key={item} className="shop-slot">
              <button
                type="button"
                disabled={disabled || broke}
                aria-pressed={armed === item}
                className={`has-sketch-frame ${armed === item ? "is-armed" : ""} ${broke ? "is-broke" : ""}`}
                title={`${meta.name}: ${meta.description}`}
                data-item={item}
                onClick={() => {
                  if (meta.targeting === "instant") setConfirming((open) => (open ? null : item));
                  else onArm(item);
                }}
              >
                <SketchFrame seed={`loja:${item}`} roughness={1.2} />
                <ItemGlyph item={item} size={24} />
                <span>{meta.name}</span>
                <b>⬡ {meta.price}</b>
              </button>
              {confirming === item ? (
                <div className="shop-confirm" role="group" aria-label={`Confirmar ${meta.name}`}>
                  <span>Usar por ⬡ {meta.price}?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onUseInstant(item);
                      setConfirming(null);
                    }}
                  >
                    Sim
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Não
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <small className="shop-note">Crédito vem de cada letra que você fecha em tinta.</small>
    </section>
  );
}
