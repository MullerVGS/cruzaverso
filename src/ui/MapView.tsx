import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";

import {
  isCoordinateRevealed,
  objectiveDirection,
  type GameState,
} from "../game/state.js";
import {
  cellsForWord,
  coordinateKey,
  type Coordinate,
  type DailyMap,
  type PlacedWord,
} from "../generation/types.js";
import { BIOME_DEFINITIONS } from "../config/game.js";

const CELL = 34;
interface MapViewProps {
  map: DailyMap;
  state: GameState;
  selectedWordId: string | null;
  availableWordIds: Set<string>;
  onCellClick: (position: Coordinate, words: PlacedWord[]) => void;
}

function KeyIcon({ x, y }: Coordinate) {
  return (
    <g className="map-object key-object" transform={`translate(${x * CELL} ${y * CELL})`}>
      <title>Chave</title>
      <circle cx="12" cy="12" r="5" />
      <path d="M16 15l9 9m-3-3 3-3m-6 0 3-3" />
    </g>
  );
}

function ExitIcon({ x, y, unlocked }: Coordinate & { unlocked: boolean }) {
  return (
    <g className={`map-object exit-object ${unlocked ? "is-unlocked" : "is-locked"}`} transform={`translate(${x * CELL} ${y * CELL})`}>
      <title>{unlocked ? "Saída aberta" : "Saída — encontre duas chaves"}</title>
      <path d="M8 28V6q8-4 17 0v22M5 28h23" />
      <circle cx="21" cy="17" r="1.7" />
    </g>
  );
}

function PowerupIcon({ x, y }: Coordinate) {
  return (
    <g className="map-object powerup-object" transform={`translate(${x * CELL} ${y * CELL})`}>
      <title>Achado para a mochila</title>
      <path d="M17 3l4 9 9 4-9 4-4 10-4-10-9-4 9-4z" />
      <circle cx="17" cy="16" r="3" />
    </g>
  );
}

export function MapView({ map, state, selectedWordId, availableWordIds, onCellClick }: MapViewProps) {
  const width = (map.bounds.maxX - map.bounds.minX + 1) * CELL;
  const height = (map.bounds.maxY - map.bounds.minY + 1) * CELL;
  const mapCenter = {
    x: (map.bounds.minX * CELL + map.bounds.maxX * CELL + CELL) / 2,
    y: (map.bounds.minY * CELL + map.bounds.maxY * CELL + CELL) / 2,
  };
  const [camera, setCamera] = useState({ ...mapCenter, zoom: 1 });
  const drag = useRef<{
    clientX: number;
    clientY: number;
    cameraX: number;
    cameraY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const cellIndex = useMemo(() => {
    const index = new Map<string, { position: Coordinate; letter: string; words: PlacedWord[] }>();
    for (const word of map.words) {
      for (const cell of cellsForWord(word)) {
        const key = coordinateKey(cell);
        const existing = index.get(key) ?? { position: cell, letter: cell.letter, words: [] };
        existing.words.push(word);
        index.set(key, existing);
      }
    }
    return [...index.entries()];
  }, [map]);
  const solved = new Set(state.solvedWordIds);
  const collected = new Set(state.collectedObjectIds);
  const direction = objectiveDirection(map, state);
  const cameraWidth = width / camera.zoom;
  const cameraHeight = height / camera.zoom;
  const viewBox = `${camera.x - cameraWidth / 2} ${camera.y - cameraHeight / 2} ${cameraWidth} ${cameraHeight}`;

  function zoomBy(amount: number) {
    setCamera((current) => ({ ...current, zoom: Math.min(3.5, Math.max(1, current.zoom + amount)) }));
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    drag.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const origin = drag.current;
    if (!origin) return;
    const deltaX = event.clientX - origin.clientX;
    const deltaY = event.clientY - origin.clientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 4 && !origin.moved) return;
    if (!origin.moved) event.currentTarget.setPointerCapture(event.pointerId);
    origin.moved = true;
    suppressClick.current = true;
    const scaleX = cameraWidth / event.currentTarget.clientWidth;
    const scaleY = cameraHeight / event.currentTarget.clientHeight;
    setCamera((current) => ({
      ...current,
      x: origin.cameraX - deltaX * scaleX,
      y: origin.cameraY - deltaY * scaleY,
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.25 : -0.25);
  }

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (["+", "=", "-", "0", "c", "w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
      }
      if (key === "+" || key === "=") zoomBy(.3);
      if (key === "-") zoomBy(-.3);
      if (key === "0") setCamera({ ...mapCenter, zoom: 1 });
      if (key === "c") {
        setCamera({
          x: state.player.x * CELL + CELL / 2,
          y: state.player.y * CELL + CELL / 2,
          zoom: Math.max(2, camera.zoom),
        });
      }
      const pan = Math.min(cameraWidth, cameraHeight) * .1;
      if (key === "w") setCamera((current) => ({ ...current, y: current.y - pan }));
      if (key === "s") setCamera((current) => ({ ...current, y: current.y + pan }));
      if (key === "a") setCamera((current) => ({ ...current, x: current.x - pan }));
      if (key === "d") setCamera((current) => ({ ...current, x: current.x + pan }));
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [camera.zoom, cameraHeight, cameraWidth, mapCenter.x, mapCenter.y, state.player.x, state.player.y]);

  return (
    <div className="atlas-frame">
      <svg
        className="atlas"
        viewBox={viewBox}
        role="img"
        aria-label="Mapa de palavras cruzadas do dia"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <filter id="paper-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".22" />
          </filter>
          <pattern id="paper-grain" width={width} height={height} patternUnits="userSpaceOnUse">
            <image href="/assets/atlas-paper.png" width={width} height={height} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        </defs>
        <rect
          x={map.bounds.minX * CELL}
          y={map.bounds.minY * CELL}
          width={width}
          height={height}
          rx="26"
          fill="url(#paper-grain)"
        />
        <rect
          className="paper-wash"
          x={map.bounds.minX * CELL}
          y={map.bounds.minY * CELL}
          width={width}
          height={height}
          rx="26"
        />

        <g className="biome-washes" aria-hidden="true">
          {map.words.map((word) => {
            const cells = cellsForWord(word);
            const first = cells[0];
            const last = cells.at(-1);
            if (!first || !last) return null;
            return (
              <line
                key={`biome-${word.id}`}
                x1={first.x * CELL + CELL / 2}
                y1={first.y * CELL + CELL / 2}
                x2={last.x * CELL + CELL / 2}
                y2={last.y * CELL + CELL / 2}
                stroke={BIOME_DEFINITIONS[word.biome].color}
                strokeWidth={CELL * 1.85}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        <g className="crossword-cells">
          {cellIndex.map(([key, cell], index) => {
            const cellSolved = cell.words.some((word) => solved.has(word.id));
            const revealed = state.status === "won" || cellSolved || isCoordinateRevealed(state, cell.position);
            const selected = cell.words.some((word) => word.id === selectedWordId);
            const available = cell.words.some((word) => availableWordIds.has(word.id));
            const value =
              state.status === "won"
                ? cell.letter
                : state.ink[key] ?? state.pencil[key] ?? "";
            return (
              <g
                key={key}
                className={[
                  "crossword-cell",
                  revealed ? "is-revealed" : "is-fogged",
                  cellSolved ? "is-solved" : "",
                  selected ? "is-selected" : "",
                  available ? "is-available" : "",
                ].join(" ")}
                transform={`translate(${cell.position.x * CELL} ${cell.position.y * CELL}) rotate(${index % 3 === 0 ? -0.3 : index % 3 === 1 ? 0.25 : 0})`}
                onClick={() => {
                  if (!suppressClick.current) onCellClick(cell.position, cell.words);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onCellClick(cell.position, cell.words);
                  }
                }}
                data-cell-key={key}
                role="button"
                tabIndex={0}
              >
                <rect width={CELL - 2} height={CELL - 2} rx="3" />
                {revealed && value ? (
                  <text x={(CELL - 2) / 2} y={CELL * 0.68} className={cellSolved || state.status === "won" ? "ink-letter" : "pencil-letter"}>
                    {value}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        <g className="objects" filter="url(#paper-shadow)">
          {map.objects.map((object) => {
            const visible =
              state.status === "won" ||
              collected.has(object.id) ||
              isCoordinateRevealed(state, object.position);
            if (!visible || collected.has(object.id)) return null;
            if (object.type === "key") return <KeyIcon key={object.id} {...object.position} />;
            if (object.type === "exit") {
              return <ExitIcon key={object.id} {...object.position} unlocked={state.keysCollected >= map.objective.keysRequired} />;
            }
            return <PowerupIcon key={object.id} {...object.position} />;
          })}
        </g>

        {direction ? (
          <g
            className="direction-arrow"
            transform={`translate(${state.player.x * CELL + CELL / 2} ${state.player.y * CELL + CELL / 2}) rotate(${Math.atan2(direction.y, direction.x) * (180 / Math.PI)})`}
          >
            <path d="M22 0l-8-6v4H3v4h11v4z" />
          </g>
        ) : null}

        <g
          className="explorer-marker"
          transform={`translate(${state.player.x * CELL + CELL / 2} ${state.player.y * CELL + CELL / 2})`}
          aria-label="Sua posição"
        >
          <circle r="11" />
          <path d="M0-7 5 6 0 3-5 6z" />
        </g>
      </svg>
      <div className="map-controls" aria-label="Controles do mapa">
        <button type="button" onClick={() => zoomBy(.35)} aria-label="Aproximar mapa">+</button>
        <button type="button" onClick={() => zoomBy(-.35)} aria-label="Afastar mapa">−</button>
        <button type="button" onClick={() => setCamera({ ...mapCenter, zoom: 1 })} aria-label="Ver mapa inteiro">⌗</button>
        <button type="button" onClick={() => setCamera({ x: state.player.x * CELL + CELL / 2, y: state.player.y * CELL + CELL / 2, zoom: Math.max(2, camera.zoom) })} aria-label="Centralizar no explorador">⌖</button>
      </div>
      <div className="map-legend" aria-label="Legenda dos biomas">
        <span><i className="dot cotidiano" />Cotidiano</span>
        <span><i className="dot ciencia" />Ciência</span>
        <span><i className="dot historia" />História</span>
        <span><i className="dot cultura" />Cultura Pop</span>
      </div>
    </div>
  );
}
