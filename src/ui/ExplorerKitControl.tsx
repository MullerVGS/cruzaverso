import { useEffect, useRef, useState } from "react";

import { EXPLORER, needleById, type NeedleUnlock } from "../config/game.js";
import { chooseNeedle, equipCompass, type ExplorerKit } from "../game/explorer-kit.js";
import { SketchFrame } from "./SketchFrame.js";

interface ExplorerKitControlProps {
  kit: ExplorerKit;
  onChange: (kit: ExplorerKit) => void;
  /** Onde o painel se ancora: o botão vive em cantos diferentes nas duas telas. */
  placement: "landing" | "run";
}

const TODAS_EM_MAOS = "As três agulhas são suas. O aro é seu desde o primeiro passo.";

/**
 * O marco de cada agulha, dito uma vez só: a mesma frase serve à dica da peça
 * bloqueada e ao rodapé que lista o que falta. Duas redações do mesmo fato
 * divergem na primeira vez que uma delas muda.
 */
const UNLOCK_HINT: Record<NeedleUnlock, string> = {
  initial: "",
  "daily-win": "conclua uma expedição diária",
  "free-win": "recolha todas as moedas de uma expedição livre",
};

function pendingHint(needle: (typeof EXPLORER.needles)[number]): string {
  return `${needle.label}: ${UNLOCK_HINT[needle.unlock]}.`;
}

/**
 * O instrumento do explorador: aro sempre em mãos, agulhas conquistadas uma a
 * uma. Vive fora dos ajustes porque é vitrine de conquista, não preferência —
 * e por isso abre igual na tela inicial e no meio da expedição.
 */
export function ExplorerKitControl({ kit, onChange, placement }: ExplorerKitControlProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const chosen = needleById(kit.needle);
  const pending = EXPLORER.needles
    .filter((needle) => !kit.unlockedNeedles.includes(needle.id))
    .map(pendingHint);

  return (
    <div className={`kit-control is-${placement}`} ref={root}>
      <button
        className="kit-button"
        type="button"
        aria-label="Instrumento do explorador"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <img src={EXPLORER.compass.housing} alt="" />
      </button>

      {open ? (
        <section className="kit-panel has-sketch-frame" aria-label="Instrumento do explorador">
          <SketchFrame seed="painel-instrumento" roughness={1.6} />
          <h3>Instrumento</h3>

          <div className="kit-preview">
            <img className="kit-housing" src={EXPLORER.compass.housing} alt="" />
            <img className="kit-needle" src={chosen.asset} alt="" />
          </div>

          <label>
            <span>Equipar a bússola</span>
            <input
              type="checkbox"
              checked={kit.compassEquipped}
              onChange={(event) => onChange(equipCompass(kit, event.target.checked))}
            />
          </label>

          <div className="needle-picker" role="radiogroup" aria-label="Agulha da bússola">
            {EXPLORER.needles.map((needle) => {
              const unlocked = kit.unlockedNeedles.includes(needle.id);
              return (
                <button
                  key={needle.id}
                  type="button"
                  role="radio"
                  data-needle-id={needle.id}
                  aria-checked={kit.needle === needle.id}
                  className={[
                    kit.needle === needle.id ? "is-chosen" : "",
                    unlocked ? "" : "is-locked",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={!unlocked || !kit.compassEquipped}
                  title={unlocked ? needle.description : pendingHint(needle)}
                  onClick={() => onChange(chooseNeedle(kit, needle.id))}
                >
                  <img src={needle.asset} alt="" />
                  <span>{needle.label}</span>
                </button>
              );
            })}
          </div>

          <small>{pending.length === 0 ? TODAS_EM_MAOS : pending.join(" ")}</small>
        </section>
      ) : null}
    </div>
  );
}
