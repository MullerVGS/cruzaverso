import { useEffect, useState } from "react";

import { EXPLORER, needleById } from "../config/game.js";
import type { ExplorerKit } from "../game/explorer-kit.js";

interface ExplorerMarkerProps {
  /** Centro da casa em que o explorador está, em coordenadas do atlas. */
  x: number;
  y: number;
  cell: number;
  kit: ExplorerKit;
  /** Rumo em graus, zero no norte. Sem alvo, a agulha repousa no norte. */
  bearing: number;
  aiming: boolean;
  /** Letra da casa pisada, para o instrumento não engolir o que está embaixo. */
  letter: string;
}

/** O aro transborda a casa: é instrumento pousado na carta, não peça do tabuleiro. */
const HOUSING_CELLS = 1.62;

export function ExplorerMarker({
  x,
  y,
  cell,
  kit,
  bearing,
  aiming,
  letter,
}: ExplorerMarkerProps) {
  // Parado, o instrumento recua e devolve a casa ao jogador: quem parou de
  // andar voltou a ler a palavra, e aro e agulha estão justamente por cima
  // dela. Ao primeiro passo ele reaparece inteiro.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    const timer = window.setTimeout(() => setIdle(true), EXPLORER.restDelayMs);
    return () => window.clearTimeout(timer);
  }, [x, y]);

  if (!kit.compassEquipped) {
    return (
      <g className="explorer-marker" transform={`translate(${x} ${y})`} aria-label="Sua posição">
        <circle r="11" />
        <path d="M0-7 5 6 0 3-5 6z" />
      </g>
    );
  }

  const needle = needleById(kit.needle);
  const housingSize = cell * HOUSING_CELLS;
  const dialRadius = housingSize * EXPLORER.compass.dialRadius;
  // A agulha é dimensionada pelo alcance medido na arte, então trocar de skin
  // não desalinha a ponta com a borda do mostrador.
  const needleSize = (dialRadius * EXPLORER.compass.needleFill) / needle.reach;

  return (
    <g
      className={[
        "explorer-compass",
        aiming ? "is-aiming" : "is-resting",
        idle ? "is-idle" : "",
      ].join(" ")}
      transform={`translate(${x} ${y})`}
      aria-label="Sua posição"
    >
      <image
        className="compass-housing"
        href={EXPLORER.compass.housing}
        x={-EXPLORER.compass.center.x * housingSize}
        y={-EXPLORER.compass.center.y * housingSize}
        width={housingSize}
        height={housingSize}
      />
      {/* O mostrador carrega a letra da casa pisada, e é a única camada que
          nunca desbota: é ela que o jogador precisa ler. */}
      {letter ? (
        <text className="compass-dial-letter" x="0" y={cell * 0.2} fontSize={cell * 0.62}>
          {letter}
        </text>
      ) : null}
      <g className="compass-sway">
        <image
          className="compass-needle"
          href={needle.asset}
          x={-needle.pivot.x * needleSize}
          y={-needle.pivot.y * needleSize}
          width={needleSize}
          height={needleSize}
          transform={`rotate(${bearing.toFixed(2)})`}
        />
      </g>
    </g>
  );
}
