import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";

import {
  isCoordinateRevealed,
  objectiveDirection,
  routeTo,
  type GameState,
} from "../game/state.js";
import { needleBearing, type ExplorerKit } from "../game/explorer-kit.js";
import { ExplorerMarker } from "./ExplorerMarker.js";
import {
  cellsForWord,
  coordinateKey,
  parseCoordinateKey,
  type Coordinate,
  type DailyMap,
  type ItemType,
  type PlacedWord,
} from "../generation/types.js";
import { BIOME_DEFINITIONS, ITEM_DEFINITIONS } from "../config/game.js";
import { sketchBlob, sketchRect } from "../render/sketch.js";
import { BiomeAtlas } from "./BiomeAtlas.js";
import { FogChart } from "./FogChart.js";
import { SketchFrame } from "./SketchFrame.js";

const CELL = 34;
/** Células amostradas além do recorte: é o que faz a fronteira continuar do lado de fora. */
const BLEED = 7;
/** Traços de hachura de litoral proporcionais ao raio da abertura. */
function hachureTicks(radius: number): number {
  return Math.max(9, Math.min(40, Math.round(radius / 11)));
}
interface MapViewProps {
  map: DailyMap;
  state: GameState;
  kit: ExplorerKit;
  selectedWordId: string | null;
  activeCellKey: string | null;
  availableWordIds: Set<string>;
  wordNumbers: Map<string, number>;
  hoveredWordId: string | null;
  onHoverWord: (wordId: string | null) => void;
  armedTargeting: (typeof ITEM_DEFINITIONS)[ItemType]["targeting"] | null;
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

function CoinIcon({ x, y }: Coordinate) {
  return (
    <g className="map-object coin-object" transform={`translate(${x * CELL} ${y * CELL})`}>
      <title>Moeda</title>
      <circle cx="16" cy="16" r="8.5" />
      <circle className="coin-rim" cx="16" cy="16" r="5.6" />
      <path d="M16 12.4v7.2M14 14.2h3.4a1.6 1.6 0 0 1 0 3.2H14" />
    </g>
  );
}

export function MapView({
  map,
  state,
  kit,
  selectedWordId,
  activeCellKey,
  availableWordIds,
  wordNumbers,
  hoveredWordId,
  onHoverWord,
  armedTargeting,
  onCellClick,
}: MapViewProps) {
  const width = (map.bounds.maxX - map.bounds.minX + 1) * CELL;
  const height = (map.bounds.maxY - map.bounds.minY + 1) * CELL;
  const mapCenter = {
    x: (map.bounds.minX * CELL + map.bounds.maxX * CELL + CELL) / 2,
    y: (map.bounds.minY * CELL + map.bounds.maxY * CELL + CELL) / 2,
  };
  const [camera, setCamera] = useState({ ...mapCenter, zoom: 1 });
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
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
  // O traço de cada célula e de cada moldura é estável: depende só do mapa.
  // Sem o memo, digitar uma letra recalcularia ~250 paths tremidos.
  const cellOutlines = useMemo(() => {
    const outlines = new Map<string, string>();
    for (const [key] of cellIndex) {
      outlines.set(key, sketchRect(0, 0, CELL - 2, CELL - 2, `celula:${key}`, { roughness: .85, step: 14 }));
    }
    return outlines;
  }, [cellIndex]);
  const wordOutlines = useMemo(() => {
    const outlines = new Map<string, string>();
    for (const word of map.words) {
      const horizontal = word.orientation === "horizontal";
      const length = word.gridAnswer.length;
      outlines.set(
        word.id,
        sketchRect(
          word.start.x * CELL - 4,
          word.start.y * CELL - 4,
          (horizontal ? length : 1) * CELL + 6,
          (horizontal ? 1 : length) * CELL + 6,
          `moldura:${word.id}`,
          { roughness: 1.3, step: 26 },
        ),
      );
    }
    return outlines;
  }, [map.words]);
  const solved = new Set(state.solvedWordIds);
  const collected = new Set(state.collectedObjectIds);
  const detailedWordIds = useMemo(() => {
    const detailed = new Set<string>();
    for (const word of map.words) {
      if (
        state.status === "won" ||
        state.solvedWordIds.includes(word.id) ||
        availableWordIds.has(word.id) ||
        cellsForWord(word).some((cell) => isCoordinateRevealed(state, cell))
      ) {
        detailed.add(word.id);
      }
    }
    return detailed;
  }, [availableWordIds, map.words, state]);
  // A mira só destaca quando o alvo é uma casa ou uma palavra; a Luneta aceita
  // qualquer ponto e destacar tudo seria o mesmo que não destacar nada.
  const aiming =
    armedTargeting === "cell" || armedTargeting === "word" || armedTargeting === "route";
  // O número mora na casa em que a palavra começa; casa compartilhada por uma
  // vertical e uma horizontal carrega um número só.
  const numberByStartKey = useMemo(() => {
    const byStart = new Map<string, number>();
    for (const word of map.words) {
      const number = wordNumbers.get(word.id);
      if (number !== undefined) byStart.set(coordinateKey(word.start), number);
    }
    return byStart;
  }, [map, wordNumbers]);

  /** Numa casa de cruzamento, acende a palavra que o jogador pode abrir. */
  function wordToHighlight(words: readonly PlacedWord[]): string | null {
    const aberta = words.find((word) => availableWordIds.has(word.id) && !solved.has(word.id));
    return (aberta ?? words[0])?.id ?? null;
  }

  const cellViews = cellIndex.map(([key, cell], index) => ({
    key,
    cell,
    aimTarget:
      aiming &&
      (armedTargeting === "route"
        ? // A Luneta mira o contrário das outras: rota já avistada que ainda
          // não abriu. Só ela é alvo válido.
          cell.words.some(
            (word) =>
              !availableWordIds.has(word.id) &&
              !solved.has(word.id) &&
              detailedWordIds.has(word.id),
          )
        : cell.words.some(
            (word) =>
              availableWordIds.has(word.id) &&
              !solved.has(word.id) &&
              (armedTargeting === "cell"
                ? !state.ink[key]
                : !state.simplifiedWordIds.includes(word.id)),
          )),
    hinted: state.hintedCellKeys.includes(key),
    cellSolved: cell.words.some((word) => solved.has(word.id)),
    detailed: cell.words.some((word) => detailedWordIds.has(word.id)),
    selected: cell.words.some((word) => word.id === selectedWordId),
    hovered: hoveredWordId !== null && cell.words.some((word) => word.id === hoveredWordId),
    available: cell.words.some((word) => availableWordIds.has(word.id)),
    value: state.status === "won"
      ? cell.letter
      : state.ink[key] ?? state.pencil[key] ?? "",
    rotation: index % 3 === 0 ? -0.3 : index % 3 === 1 ? 0.25 : 0,
  }));
  // Máscara da névoa, máscara inversa e litoral têm que compartilhar exatamente
  // a mesma mancha, senão o contorno desenhado descola da abertura.
  const openingPath = (zone: { x: number; y: number; radius: number }) =>
    sketchBlob(
      zone.x * CELL + CELL / 2,
      zone.y * CELL + CELL / 2,
      (zone.radius + .9) * CELL,
      `${map.id}:abertura:${zone.x},${zone.y},${zone.radius}`,
    );
  const bleedBox = {
    x: (map.bounds.minX - BLEED) * CELL,
    y: (map.bounds.minY - BLEED) * CELL,
    width: width + BLEED * 2 * CELL,
    height: height + BLEED * 2 * CELL,
  };
  // A legenda anunciava todos os biomas sempre; o recorte do dia costuma ter
  // menos. Prometer bioma que não está no mapa é ruído, não informação.
  const presentBiomes = useMemo(() => {
    const present = new Set(map.words.map((word) => word.biome));
    return (Object.keys(BIOME_DEFINITIONS) as Array<keyof typeof BIOME_DEFINITIONS>)
      .filter((biome) => present.has(biome));
  }, [map.words]);
  const direction = objectiveDirection(map, state);
  const compassEquipped = kit.compassUnlocked && kit.compassEquipped;
  const playerLetter =
    cellViews.find((view) => view.key === coordinateKey(state.player))?.value ?? "";
  // A câmera enquadra o recorte com folga: sem ela a moldura do recorte cai
  // exatamente na borda e some, e o sangramento — que é o indício de mapa
  // maior — nunca aparece.
  const cameraWidth = (width + BLEED * CELL) / camera.zoom;
  const cameraHeight = (height + BLEED * CELL) / camera.zoom;
  const viewBox = `${camera.x - cameraWidth / 2} ${camera.y - cameraHeight / 2} ${cameraWidth} ${cameraHeight}`;
  const playerCenter = {
    x: state.player.x * CELL + CELL / 2,
    y: state.player.y * CELL + CELL / 2,
  };
  // Rota que o explorador percorreria até a casa sob o ponteiro. É o que
  // responde "até onde dá para andar" sem precisar tentar e levar um recado.
  const previewRoute = useMemo(() => {
    if (!hoveredCellKey || aiming || state.status === "won") return null;
    const route = routeTo(map, state, parseCoordinateKey(hoveredCellKey));
    return route && route.length > 0 ? route : null;
  }, [aiming, hoveredCellKey, map, state]);

  // A câmera segue o explorador por zona morta: enquanto ele estiver no miolo
  // do enquadramento ela não se mexe, e quem arrastou o mapa continua onde
  // parou. Só quando ele encosta na borda a carta desliza atrás dele — e nunca
  // além da própria carta. Sem essa trava, no enquadramento inteiro (zoom 1,
  // onde o recorte já cabe) andar até a beirada empurrava o lado oposto do
  // mapa para fora da tela.
  useEffect(() => {
    setCamera((current) => {
      const framedWidth = width + BLEED * CELL;
      const framedHeight = height + BLEED * CELL;
      const visibleWidth = framedWidth / current.zoom;
      const visibleHeight = framedHeight / current.zoom;
      const marginX = visibleWidth * 0.32;
      const marginY = visibleHeight * 0.32;
      const target = {
        x: state.player.x * CELL + CELL / 2,
        y: state.player.y * CELL + CELL / 2,
      };
      let x = current.x;
      let y = current.y;
      if (target.x < x - visibleWidth / 2 + marginX) x = target.x + visibleWidth / 2 - marginX;
      else if (target.x > x + visibleWidth / 2 - marginX) x = target.x - visibleWidth / 2 + marginX;
      if (target.y < y - visibleHeight / 2 + marginY) y = target.y + visibleHeight / 2 - marginY;
      else if (target.y > y + visibleHeight / 2 - marginY) y = target.y - visibleHeight / 2 + marginY;

      const slackX = (framedWidth - visibleWidth) / 2;
      const slackY = (framedHeight - visibleHeight) / 2;
      x = slackX <= 0 ? mapCenter.x : Math.min(mapCenter.x + slackX, Math.max(mapCenter.x - slackX, x));
      y = slackY <= 0 ? mapCenter.y : Math.min(mapCenter.y + slackY, Math.max(mapCenter.y - slackY, y));

      return x === current.x && y === current.y ? current : { ...current, x, y };
    });
  }, [height, mapCenter.x, mapCenter.y, state.player.x, state.player.y, width]);

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
    // Fora de qualquer casa o alvo é a própria folha: aí a rota prevista some
    // em vez de ficar pendurada na última casa que o ponteiro tocou.
    if (event.target === event.currentTarget && hoveredCellKey !== null) {
      setHoveredCellKey(null);
      onHoverWord(null);
    }
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
      if (
        (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) &&
        event.target.id !== "answer-input"
      ) return;
      const key = event.key.toLowerCase();
      const cameraPan = event.shiftKey && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key);
      if (["+", "=", "-", "0", "home"].includes(key) || cameraPan) {
        event.preventDefault();
      }
      if (key === "+" || key === "=") zoomBy(.3);
      if (key === "-") zoomBy(-.3);
      if (key === "0") setCamera({ ...mapCenter, zoom: 1 });
      if (key === "home") {
        setCamera({
          x: state.player.x * CELL + CELL / 2,
          y: state.player.y * CELL + CELL / 2,
          zoom: Math.max(2, camera.zoom),
        });
      }
      if (cameraPan) {
        const pan = Math.min(cameraWidth, cameraHeight) * .1;
        if (key === "arrowleft") setCamera((current) => ({ ...current, x: current.x - pan }));
        if (key === "arrowright") setCamera((current) => ({ ...current, x: current.x + pan }));
        if (key === "arrowup") setCamera((current) => ({ ...current, y: current.y - pan }));
        if (key === "arrowdown") setCamera((current) => ({ ...current, y: current.y + pan }));
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [camera.zoom, cameraHeight, cameraWidth, mapCenter.x, mapCenter.y, state.player.x, state.player.y]);

  return (
    <div className="atlas-frame">
      <svg
        className={`atlas ${aiming ? "is-aiming" : ""}`.trim()}
        viewBox={viewBox}
        role="img"
        aria-label="Mapa de palavras cruzadas do dia"
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          setHoveredCellKey(null);
          onHoverWord(null);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <filter id="biome-wash-blur" x="-12%" y="-12%" width="124%" height="124%">
            <feGaussianBlur stdDeviation={CELL * .55} />
          </filter>
          {Object.entries(BIOME_DEFINITIONS).map(([biome, definition]) => (
            <pattern
              key={`hatch-${biome}`}
              id={`biome-hatch-${biome}`}
              width="9"
              height="9"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(38)"
            >
              <path d="M0 0v9" stroke={definition.color} strokeWidth="1.1" opacity=".24" />
            </pattern>
          ))}
          {/* Ruído fractal é caro por pixel. Confinado a um ladrilho de 256px
              com stitchTiles, o filtro roda uma vez e o navegador repete o
              ladrilho; solto sobre o mapa inteiro ele era recalculado a cada
              quadro de arrasto e travava o pan. */}
          <filter id="fog-grain" x="0" y="0" width="256" height="256" filterUnits="userSpaceOnUse">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.014 0.019"
              numOctaves="3"
              seed="7"
              stitchTiles="stitch"
              result="nuvem"
            />
            <feColorMatrix
              in="nuvem"
              type="matrix"
              values="0 0 0 0 .22  0 0 0 0 .27  0 0 0 0 .25  0 0 0 .55 0"
            />
          </filter>
          <pattern id="fog-grain-tile" width="256" height="256" patternUnits="userSpaceOnUse">
            <rect width="256" height="256" filter="url(#fog-grain)" />
          </pattern>
          <filter id="paper-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".22" />
          </filter>
          <pattern id="paper-grain" width={width} height={height} patternUnits="userSpaceOnUse">
            <image href="/assets/atlas-paper.png" width={width} height={height} preserveAspectRatio="xMidYMid slice" />
          </pattern>
          <radialGradient id="fog-haze" cx="42%" cy="38%" r="82%">
            <stop offset="0" stopColor="rgb(224 214 188 / 30%)" />
            <stop offset=".45" stopColor="rgb(96 104 88 / 38%)" />
            <stop offset="1" stopColor="rgb(44 56 48 / 54%)" />
          </radialGradient>
          <filter id="fog-opening-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <mask id="fog-mask" {...bleedBox} maskUnits="userSpaceOnUse">
            <rect {...bleedBox} fill="white" />
            <g filter="url(#fog-opening-soft)">
              {state.revealZones.map((zone, index) => (
                <path key={`fog-opening-${index}`} d={openingPath(zone)} fill="black" />
              ))}
              {state.capturedCellKeys.map((key) => {
                const cell = parseCoordinateKey(key);
                return <rect key={`captured-${key}`} x={cell.x * CELL} y={cell.y * CELL} width={CELL} height={CELL} fill="black" />;
              })}
            </g>
          </mask>
          {/* Inversa da névoa: o litoral desenhado só sobrevive do lado fechado,
              então manchas sobrepostas não riscam o que já foi explorado. */}
          <mask id="fog-coast-mask" {...bleedBox} maskUnits="userSpaceOnUse">
            <rect {...bleedBox} fill="white" />
            {state.revealZones.map((zone, index) => (
              <path key={`coast-cut-${index}`} d={openingPath(zone)} fill="black" />
            ))}
          </mask>
        </defs>
        <rect {...bleedBox} fill="url(#paper-grain)" />
        <rect className="paper-wash" {...bleedBox} />

        <BiomeAtlas map={map} cell={CELL} bleed={BLEED} />

        {state.status !== "won" ? (
          <>
            <g className="fog-layer" mask="url(#fog-mask)" aria-hidden="true">
              <rect {...bleedBox} className="fog-wash" />
              <rect {...bleedBox} className="fog-grain" fill="url(#fog-grain-tile)" />
              <FogChart map={map} cell={CELL} bleed={BLEED} />
            </g>
            <g className="fog-coast" mask="url(#fog-coast-mask)" aria-hidden="true">
              {state.revealZones.map((zone, index) => {
                const centerX = zone.x * CELL + CELL / 2;
                const centerY = zone.y * CELL + CELL / 2;
                const radius = (zone.radius + .9) * CELL;
                return (
                  <g key={`coast-${index}`}>
                    <path className="coast-outline" d={openingPath(zone)} />
                    {/* Hachura curta apontando para fora, como carta antiga
                        marcando o lado desconhecido do litoral. */}
                    <g className="coast-hachure">
                      {Array.from({ length: hachureTicks(radius) }, (_, tick) => {
                        const angle = (tick / hachureTicks(radius)) * Math.PI * 2;
                        const inner = radius * .99;
                        const outer = radius * (1.06 + (tick % 3) * .022);
                        return (
                          <path
                            key={`hachura-${index}-${tick}`}
                            d={`M${(centerX + Math.cos(angle) * inner).toFixed(2)} ${(centerY + Math.sin(angle) * inner).toFixed(2)} L${(centerX + Math.cos(angle) * outer).toFixed(2)} ${(centerY + Math.sin(angle) * outer).toFixed(2)}`}
                          />
                        );
                      })}
                    </g>
                  </g>
                );
              })}
            </g>
          </>
        ) : (
          /* Vitória: a névoa sai, mas a carta fica. Sem isto o jogador clica em
             "revelar atlas completo" e recebe um mapa pelado. */
          <g className="fog-chart-revealed" aria-hidden="true">
            <FogChart map={map} cell={CELL} bleed={BLEED} />
          </g>
        )}

        {/* Moldura do recorte: o traço trêmulo diz "isto é um pedaço", e as
            fronteiras que a cruzam dizem de que mapa maior ele foi tirado. */}
        <path
          className="section-frame"
          d={sketchRect(
            map.bounds.minX * CELL,
            map.bounds.minY * CELL,
            width,
            height,
            `${map.id}:moldura`,
            { roughness: 2.2, step: 40 },
          )}
        />

        <g className="word-frames" aria-hidden="true">
          {map.words.map((word) => {
            const length = word.gridAnswer.length;
            return (
              <path
                key={`frame-${word.id}`}
                data-word-frame={word.id}
                data-word-length={length}
                className={[
                  "word-frame",
                  detailedWordIds.has(word.id) ? "is-detailed" : "is-distant",
                  availableWordIds.has(word.id) ? "is-available" : "",
                  solved.has(word.id) ? "is-solved" : "",
                  selectedWordId === word.id ? "is-selected" : "",
                  hoveredWordId === word.id ? "is-hovered" : "",
                ].join(" ")}
                d={wordOutlines.get(word.id)}
              />
            );
          })}
        </g>

        <g className="crossword-cells">
          {cellViews.map(({ key, cell, cellSolved, detailed, selected, available, aimTarget, hovered, rotation }) => {
            return (
              <g
                key={key}
                className={[
                  "crossword-cell",
                  detailed ? "is-detailed" : "is-distant",
                  cellSolved ? "is-solved" : "",
                  selected ? "is-selected" : "",
                  selected && key === activeCellKey ? "is-active" : "",
                  available ? "is-available" : "",
                  aimTarget ? "is-target" : "",
                  hovered ? "is-hovered" : "",
                ].join(" ")}
                transform={`translate(${cell.position.x * CELL} ${cell.position.y * CELL}) rotate(${rotation})`}
                onPointerEnter={() => {
                  setHoveredCellKey(key);
                  if (!detailed) return;
                  onHoverWord(wordToHighlight(cell.words));
                }}
                onClick={() => {
                  if (suppressClick.current) return;
                  onCellClick(cell.position, cell.words);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onCellClick(cell.position, cell.words);
                  }
                }}
                data-cell-key={key}
                role="button"
                tabIndex={-1}
              >
                <path d={cellOutlines.get(key)} />
              </g>
            );
          })}
        </g>

        <g className="cell-numbers" aria-hidden="true">
          {cellViews.map(({ key, cell, detailed, available, cellSolved }) => {
            const number = numberByStartKey.get(key);
            // Numerar casa na névoa entregaria onde existe palavra por descobrir.
            if (!detailed || number === undefined) return null;
            return (
              <text
                key={`numero-${key}`}
                data-number-key={key}
                // O número acompanha a rota: enquanto ela não abre, ele recua
                // junto com a casa em vez de saltar da carta.
                className={available || cellSolved ? undefined : "is-locked"}
                x={cell.position.x * CELL + 1}
                y={cell.position.y * CELL - 3}
              >
                {number}
              </text>
            );
          })}
        </g>

        <g className="cell-letters" aria-hidden="true">
          {cellViews.map(({ key, cell, detailed, cellSolved, hinted, value, rotation }) => {
            if (!detailed || !value) return null;
            return (
              <text
                key={`letter-${key}`}
                data-letter-key={key}
                x={cell.position.x * CELL + (CELL - 2) / 2}
                y={cell.position.y * CELL + CELL * .68}
                transform={`rotate(${rotation} ${cell.position.x * CELL + CELL / 2} ${cell.position.y * CELL + CELL / 2})`}
                className={`${cellSolved || state.status === "won" ? "ink-letter" : "pencil-letter"}${hinted ? " is-hinted" : ""}`}
              >
                {value}
              </text>
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
              return (
                <ExitIcon
                  key={object.id}
                  {...object.position}
                  unlocked={
                    map.objective.kind === "keys-and-exit" &&
                    state.keysCollected >= map.objective.keysRequired
                  }
                />
              );
            }
            return <CoinIcon key={object.id} {...object.position} />;
          })}
        </g>

        {previewRoute ? (
          <g className="route-preview" aria-hidden="true">
            <path
              d={`M${playerCenter.x} ${playerCenter.y} ${previewRoute
                .map((step) => `L${step.x * CELL + CELL / 2} ${step.y * CELL + CELL / 2}`)
                .join(" ")}`}
            />
            <circle
              className="route-preview-goal"
              cx={previewRoute[previewRoute.length - 1]!.x * CELL + CELL / 2}
              cy={previewRoute[previewRoute.length - 1]!.y * CELL + CELL / 2}
              r={CELL * 0.34}
            />
          </g>
        ) : null}

        {/* Com a bússola equipada, a agulha é o mostrador da direção comprada.
            Sem ela, segue a seta de sempre — dois indicadores ao mesmo tempo
            seria a mesma informação dita duas vezes. */}
        {direction && !compassEquipped ? (
          <g
            className="direction-arrow"
            transform={`translate(${playerCenter.x} ${playerCenter.y}) rotate(${Math.atan2(direction.y, direction.x) * (180 / Math.PI)})`}
          >
            <path d="M22 0l-8-6v4H3v4h11v4z" />
          </g>
        ) : null}

        <g data-player-key={coordinateKey(state.player)}>
          <ExplorerMarker
            x={playerCenter.x}
            y={playerCenter.y}
            cell={CELL}
            kit={kit}
            bearing={needleBearing(direction)}
            aiming={Boolean(direction)}
            letter={playerLetter}
          />
        </g>
      </svg>
      <div className="map-controls has-sketch-frame" aria-label="Controles do mapa">
        <SketchFrame seed="controles-mapa" roughness={1.2} />
        <button type="button" onClick={() => zoomBy(.35)} aria-label="Aproximar mapa">+</button>
        <button type="button" onClick={() => zoomBy(-.35)} aria-label="Afastar mapa">−</button>
        <button type="button" onClick={() => setCamera({ ...mapCenter, zoom: 1 })} aria-label="Ver mapa inteiro">⌗</button>
        <button type="button" onClick={() => setCamera({ x: state.player.x * CELL + CELL / 2, y: state.player.y * CELL + CELL / 2, zoom: Math.max(2, camera.zoom) })} aria-label="Centralizar no explorador">⌖</button>
      </div>
      {/* Cartucho: em carta antiga é a caixa ornamentada que nomeia a folha.
          É o lugar natural da legenda depois que tudo virou desenho. */}
      <div className="map-cartouche has-sketch-frame" aria-label="Legenda do mapa">
        <SketchFrame seed={`cartucho:${map.id}`} roughness={2} />
        <strong>
          {map.mode === "daily" ? `Carta de ${map.date.split("-").reverse().join(" · ")}` : "Carta livre"}
        </strong>
        <ul>
          {presentBiomes.map((biome) => (
            <li key={biome}>
              <i style={{ background: BIOME_DEFINITIONS[biome].color }} />
              {BIOME_DEFINITIONS[biome].label}
            </li>
          ))}
        </ul>
        <small>Além da névoa, o mapa segue por desbravar.</small>
      </div>
    </div>
  );
}
