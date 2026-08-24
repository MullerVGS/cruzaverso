import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyGameAction,
  availableWords,
  createInitialGameState,
  type GameAction,
  type GameState,
} from "../game/state.js";
import {
  cellsForWord,
  coordinateKey,
  type Coordinate,
  type DailyMap,
  type PlacedWord,
  type PowerupType,
} from "../generation/types.js";
import { normalizeGridAnswer } from "../content/catalog.js";
import { GAME_BALANCE, POWERUP_DEFINITIONS } from "../config/game.js";
import { sendTelemetry } from "./api.js";
import { MapView } from "./MapView.js";
import { PowerupGlyph } from "./PowerupGlyph.js";
import { SketchFrame } from "./SketchFrame.js";
import { playSound } from "./sfx.js";

function saveKey(map: DailyMap): string {
  return `cruzaverso:save:${map.id}`;
}

function loadSavedState(map: DailyMap): GameState | null {
  try {
    const raw = localStorage.getItem(saveKey(map));
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    return state.schemaVersion === 1 && state.mapId === map.id ? state : null;
  } catch {
    return null;
  }
}

function getRunId(map: DailyMap): string {
  const key = `cruzaverso:run:${map.id}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

function formatActiveTime(activeMs: number): string {
  const totalSeconds = Math.floor(activeMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface GameScreenProps {
  map: DailyMap;
  initialState?: GameState | null;
  onBack: () => void;
}

export function GameScreen({ map, initialState, onBack }: GameScreenProps) {
  const [state, setState] = useState<GameState>(() => initialState ?? createInitialGameState(map));
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [activeCellIndex, setActiveCellIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(state.status === "won");
  const [pendingLetterTarget, setPendingLetterTarget] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(
    () => localStorage.getItem("cruzaverso:sounds") !== "off",
  );
  const [soundVolume, setSoundVolume] = useState(() => {
    const stored = Number(localStorage.getItem("cruzaverso:volume"));
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.65;
  });
  const [telemetryEnabled, setTelemetryEnabled] = useState(
    () => localStorage.getItem("cruzaverso:telemetry") !== "off",
  );
  const [tipVisible, setTipVisible] = useState(
    () => localStorage.getItem("cruzaverso:tutorial-seen") !== "yes",
  );
  const runId = useMemo(() => getRunId(map), [map]);
  const startedTelemetry = useRef(false);
  const lastActivityAt = useRef(Date.now());
  const activeCellIndexRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const soundLevel = soundsEnabled ? soundVolume : 0;

  const wordsAvailable = useMemo(() => availableWords(map, state), [map, state]);
  const availableIds = useMemo(
    () => new Set(wordsAvailable.map((word) => word.id)),
    [wordsAvailable],
  );
  const selectedWord = map.words.find((word) => word.id === selectedWordId) ?? null;
  const selectedCells = selectedWord ? cellsForWord(selectedWord) : [];
  const activeCellKey = selectedCells[activeCellIndex]
    ? coordinateKey(selectedCells[activeCellIndex])
    : null;

  useEffect(() => {
    if (!selectedWordId || !availableIds.has(selectedWordId)) {
      const frontier = wordsAvailable.find((word) => !state.solvedWordIds.includes(word.id));
      setSelectedWordId(frontier?.id ?? wordsAvailable[0]?.id ?? null);
    }
  }, [availableIds, selectedWordId, state.solvedWordIds, wordsAvailable]);

  useEffect(() => {
    if (!selectedWord) return;
    const cells = cellsForWord(selectedWord);
    const firstWritable = cells.findIndex((cell) => !stateRef.current.ink[coordinateKey(cell)]);
    const firstEmpty = cells.findIndex(
      (cell) => !stateRef.current.ink[coordinateKey(cell)] && !stateRef.current.pencil[coordinateKey(cell)],
    );
    const index = firstEmpty >= 0 ? firstEmpty : Math.max(0, firstWritable);
    setEntryCell(index);
  }, [selectedWordId]);

  useEffect(() => {
    localStorage.setItem(saveKey(map), JSON.stringify(state));
  }, [map, state]);

  useEffect(() => {
    if (startedTelemetry.current) return;
    startedTelemetry.current = true;
    sendTelemetry(telemetryEnabled, {
      runId,
      mapId: map.id,
      event: "run_started",
      elapsedActiveMs: state.activeMs,
      payload: { wordsTotal: map.words.length },
    });
  }, [map, runId, state.activeMs, telemetryEnabled]);

  useEffect(() => {
    const markActive = () => {
      lastActivityAt.current = Date.now();
    };
    window.addEventListener("pointerdown", markActive);
    window.addEventListener("keydown", markActive);
    const interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        Date.now() - lastActivityAt.current < GAME_BALANCE.activeTimeIdleAfterMs
      ) {
        setState((current) => applyGameAction(map, current, { type: "add-active-time", milliseconds: 1_000 }));
      }
    }, 1_000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
    };
  }, [map]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (settingsOpen || summaryOpen || state.status === "won") return;
      const typingTarget = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "Tab") {
        event.preventDefault();
        cycleSelectedWord(event.shiftKey ? -1 : 1);
        return;
      }
      const movement = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      }[event.key];
      if (movement && !event.shiftKey) {
        event.preventDefault();
        perform({
          type: "move",
          destination: {
            x: stateRef.current.player.x + movement.x,
            y: stateRef.current.player.y + movement.y,
          },
        });
        return;
      }
      if (event.key === "Enter" && selectedWord && !state.solvedWordIds.includes(selectedWord.id)) {
        event.preventDefault();
        perform({ type: "submit-word", wordId: selectedWord.id });
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        eraseLetter();
        return;
      }
      if (
        !typingTarget &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.length === 1 &&
        normalizeGridAnswer(event.key).length === 1
      ) {
        event.preventDefault();
        writeLetter(normalizeGridAnswer(event.key));
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [selectedWord, selectedWordId, settingsOpen, state.solvedWordIds, state.status, summaryOpen, wordsAvailable]);

  function emitTelemetry(previous: GameState, next: GameState, action: GameAction) {
    if (next.solvedWordIds.length > previous.solvedWordIds.length) {
      sendTelemetry(telemetryEnabled, {
        runId,
        mapId: map.id,
        event: "word_solved",
        elapsedActiveMs: next.activeMs,
        payload: {
          solvedWords: next.solvedWordIds.length,
          availableWords: availableWords(map, next).length,
        },
      });
    }
    if (next.keysCollected > previous.keysCollected) {
      sendTelemetry(telemetryEnabled, {
        runId,
        mapId: map.id,
        event: "key_collected",
        elapsedActiveMs: next.activeMs,
        payload: { keysCollected: next.keysCollected },
      });
    }
    if (next.capturedCellKeys.length > previous.capturedCellKeys.length) {
      sendTelemetry(telemetryEnabled, {
        runId,
        mapId: map.id,
        event: "area_captured",
        elapsedActiveMs: next.activeMs,
        payload: {
          capturedObjects: next.collectedObjectIds.length - previous.collectedObjectIds.length,
        },
      });
    }
    if (action.type === "use-powerup" && next !== previous) {
      sendTelemetry(telemetryEnabled, {
        runId,
        mapId: map.id,
        event: "powerup_used",
        elapsedActiveMs: next.activeMs,
        payload: {
          powerupType: action.powerupType,
          inventoryCount: Object.values(next.inventory).reduce((sum, value) => sum + value, 0),
        },
      });
    }
    if (previous.status !== "won" && next.status === "won") {
      sendTelemetry(telemetryEnabled, {
        runId,
        mapId: map.id,
        event: "victory",
        elapsedActiveMs: next.activeMs,
        payload: {
          solvedWords: next.solvedWordIds.length,
          keysCollected: next.keysCollected,
          wordsTotal: map.words.length,
        },
      });
    }
  }

  function perform(action: GameAction) {
    const previous = stateRef.current;
    const next = applyGameAction(map, previous, action);
    if (next === previous) return;
    emitTelemetry(previous, next, action);
    if (next.status === "won" && previous.status !== "won") {
      playSound("victory", soundLevel);
      setSummaryOpen(true);
    } else if (next.keysCollected > previous.keysCollected || next.collectedObjectIds.length > previous.collectedObjectIds.length) {
      playSound("collect", soundLevel);
    } else if (next.solvedWordIds.length > previous.solvedWordIds.length) {
      playSound("solve", soundLevel);
    } else if (next.lastFeedback?.kind === "blocked") {
      playSound("blocked", soundLevel);
    }
    commitState(next);
  }

  function commitState(next: GameState) {
    stateRef.current = next;
    setState(next);
  }

  function setEntryCell(index: number) {
    activeCellIndexRef.current = index;
    setActiveCellIndex(index);
  }

  function cycleSelectedWord(direction: 1 | -1) {
    const candidates = wordsAvailable.filter((word) => !stateRef.current.solvedWordIds.includes(word.id));
    if (candidates.length === 0) return;
    const currentIndex = candidates.findIndex((word) => word.id === selectedWordId);
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : candidates.length - 1
      : (currentIndex + direction + candidates.length) % candidates.length;
    const next = candidates[nextIndex];
    if (next) setSelectedWordId(next.id);
  }

  function writeLetter(letter: string) {
    if (!selectedWord || stateRef.current.solvedWordIds.includes(selectedWord.id)) return;
    const cells = cellsForWord(selectedWord);
    let index = activeCellIndexRef.current;
    if (stateRef.current.ink[coordinateKey(cells[index] ?? cells[0]!)]) {
      const nextWritable = cells.findIndex(
        (cell, cellIndex) => cellIndex >= index && !stateRef.current.ink[coordinateKey(cell)],
      );
      if (nextWritable < 0) return;
      index = nextWritable;
    }
    const cell = cells[index];
    if (!cell) return;
    perform({ type: "write-cell", position: cell, letter });
    const nextWritable = cells.findIndex(
      (candidate, cellIndex) => cellIndex > index && !stateRef.current.ink[coordinateKey(candidate)],
    );
    setEntryCell(nextWritable >= 0 ? nextWritable : index);
  }

  function eraseLetter() {
    if (!selectedWord || stateRef.current.solvedWordIds.includes(selectedWord.id)) return;
    const cells = cellsForWord(selectedWord);
    let index = activeCellIndexRef.current;
    const current = cells[index];
    if (!current) return;
    if (!stateRef.current.pencil[coordinateKey(current)]) {
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        const cell = cells[candidate];
        if (cell && !stateRef.current.ink[coordinateKey(cell)]) {
          index = candidate;
          break;
        }
      }
    }
    const cell = cells[index];
    if (!cell || stateRef.current.ink[coordinateKey(cell)]) return;
    perform({ type: "write-cell", position: cell, letter: "" });
    setEntryCell(index);
  }

  function updateGuess(value: string) {
    const previous = stateRef.current;
    if (!selectedWord || previous.solvedWordIds.includes(selectedWord.id)) return;
    const normalized = normalizeGridAnswer(value).slice(0, selectedWord.gridAnswer.length);
    let next = previous;
    for (const [index, cell] of cellsForWord(selectedWord).entries()) {
      next = applyGameAction(map, next, {
        type: "write-cell",
        position: cell,
        letter: normalized[index] ?? "",
      });
    }
    if (next.solvedWordIds.length > previous.solvedWordIds.length) {
      emitTelemetry(previous, next, { type: "submit-word", wordId: selectedWord.id });
      playSound("solve", soundLevel);
    } else {
      playSound("write", soundLevel);
    }
    commitState(next);
  }

  function handleCellClick(position: Coordinate, words: PlacedWord[]) {
    if (pendingLetterTarget && selectedWord) {
      const belongsToSelected = cellsForWord(selectedWord).some(
        (cell) => coordinateKey(cell) === coordinateKey(position),
      );
      if (belongsToSelected && !state.ink[coordinateKey(position)]) {
        perform({
          type: "use-powerup",
          powerupType: "reveal-letter",
          wordId: selectedWord.id,
          position,
        });
        setPendingLetterTarget(false);
      }
      return;
    }
    const candidates = words.filter(
      (word) => availableIds.has(word.id) && !state.solvedWordIds.includes(word.id),
    );
    const solvedHere = words.some((word) => state.solvedWordIds.includes(word.id));
    if (solvedHere) {
      perform({ type: "move", destination: position });
      return;
    }
    if (candidates.length === 0) return;
    const currentIndex = candidates.findIndex((word) => word.id === selectedWordId);
    const next = candidates[(currentIndex + 1) % candidates.length] ?? candidates[0];
    if (next) {
      setSelectedWordId(next.id);
      const cellIndex = cellsForWord(next).findIndex(
        (cell) => coordinateKey(cell) === coordinateKey(position),
      );
      if (cellIndex >= 0 && !state.ink[coordinateKey(position)]) setEntryCell(cellIndex);
      return;
    }
  }

  function usePowerup(powerupType: PowerupType) {
    if (powerupType === "reveal-letter") {
      if (selectedWord) setPendingLetterTarget(true);
      return;
    }
    perform({
      type: "use-powerup",
      powerupType,
      wordId: selectedWord?.id,
    });
  }

  function resetDraft() {
    if (state.status === "won") return;
    if (!window.confirm("Apagar todos os traços e recomeçar a expedição de hoje?")) return;
    const fresh = createInitialGameState(map);
    commitState(fresh);
    setSelectedWordId(null);
    setSettingsOpen(false);
    localStorage.setItem(saveKey(map), JSON.stringify(fresh));
  }

  function setTelemetry(enabled: boolean) {
    setTelemetryEnabled(enabled);
    localStorage.setItem("cruzaverso:telemetry", enabled ? "on" : "off");
    if (!enabled) {
      void fetch("/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optOut: true }),
      });
    }
  }

  function dismissTip() {
    setTipVisible(false);
    localStorage.setItem("cruzaverso:tutorial-seen", "yes");
  }

  const unsolvedAvailable = wordsAvailable.filter((word) => !state.solvedWordIds.includes(word.id));
  const clue = selectedWord
    ? state.simplifiedWordIds.includes(selectedWord.id)
      ? selectedWord.clues.simple
      : selectedWord.clues.normal
    : "Escolha uma trilha no mapa.";
  const inventoryTotal = Object.values(state.inventory).reduce((sum, value) => sum + value, 0);

  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="wordmark" type="button" onClick={onBack} aria-label="Voltar ao início">
          <span className="wordmark-star">✣</span>
          <span><strong>Cruzaverso</strong><small>{map.date.split("-").reverse().join(" · ")}</small></span>
        </button>
        <div className="objective-strip has-sketch-frame" aria-label="Objetivo da expedição">
          <SketchFrame seed="tarja-objetivo" />
          <span className="objective-icon">⌘</span>
          <span><small>OBJETIVO</small><strong>Encontre 2 chaves e alcance a saída</strong></span>
          <b>{Math.min(state.keysCollected, 2)}<i>/2</i></b>
        </div>
        <div className="header-actions">
          <span className="active-time" title="Tempo ativo nesta expedição">◷ {formatActiveTime(state.activeMs)}</span>
          <button className="icon-button has-sketch-frame" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Abrir ajustes"><SketchFrame seed="ajustes" roughness={1} />⚙</button>
        </div>
      </header>

      <section className="game-layout">
        <MapView
          map={map}
          state={state}
          selectedWordId={selectedWordId}
          activeCellKey={activeCellKey}
          availableWordIds={availableIds}
          onCellClick={handleCellClick}
        />

        <aside className="clue-desk">
          <div className="desk-heading">
            <span><small>DIÁRIO DE CAMPO</small><strong>{unsolvedAvailable.length} rotas na fronteira</strong></span>
            <span className="solved-counter">{state.solvedWordIds.length}/{map.words.length}</span>
          </div>

          <div className="clue-tabs" role="list" aria-label="Pistas disponíveis">
            {wordsAvailable.map((word, index) => (
              <button
                type="button"
                role="listitem"
                key={word.id}
                data-word-id={word.id}
                className={`has-sketch-frame ${word.id === selectedWordId ? "active" : ""} ${state.solvedWordIds.includes(word.id) ? "solved" : ""}`}
                onClick={() => setSelectedWordId(word.id)}
                title={state.solvedWordIds.includes(word.id) ? word.answer : word.clues.normal}
              >
                <SketchFrame seed={`aba:${word.id}`} roughness={1.1} />
                <b>{index + 1}</b>
                <span>{state.solvedWordIds.includes(word.id) ? word.answer : `${word.gridAnswer.length} letras`}</span>
                <i>{word.orientation === "horizontal" ? "→" : "↓"}</i>
              </button>
            ))}
          </div>

          <section className="current-clue has-sketch-frame" aria-live="polite">
            <SketchFrame seed={selectedWord?.id ?? "pista"} />
            <span className={`biome-stamp biome-${selectedWord?.biome ?? "cotidiano"}`}>
              {selectedWord?.biome.replace("-", " ") ?? "fronteira"}
            </span>
            <p>{clue}</p>
            {selectedWord ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  perform({ type: "submit-word", wordId: selectedWord.id });
                }}
              >
                <label htmlFor="answer-input">
                  {selectedWord.orientation === "horizontal" ? "Horizontal" : "Vertical"}
                  {` · ${selectedWord.gridAnswer.length} letras`}
                </label>
                <div
                  className="answer-pattern"
                  role="group"
                  aria-label={`Resposta com ${selectedWord.gridAnswer.length} letras`}
                >
                  {selectedCells.map((cell, index) => {
                    const key = coordinateKey(cell);
                    const value = state.ink[key] ?? state.pencil[key] ?? "";
                    const inInk = Boolean(state.ink[key]);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`answer-slot has-sketch-frame ${index === activeCellIndex ? "active" : ""} ${inInk ? "in-ink" : ""}`}
                        onClick={() => {
                          if (!inInk && !state.solvedWordIds.includes(selectedWord.id)) setEntryCell(index);
                          document.querySelector<HTMLInputElement>("#answer-input")?.focus();
                        }}
                        aria-label={`Letra ${index + 1}${value ? `: ${value}` : ": vazia"}`}
                      >
                        <SketchFrame seed={`slot:${selectedWord.id}:${index}`} roughness={.9} />
                        {value}
                      </button>
                    );
                  })}
                </div>
                <div className="answer-line">
                  <input
                    id="answer-input"
                    data-selected-word-id={selectedWord.id}
                    value=""
                    placeholder="Comece a digitar…"
                    onChange={(event) => {
                      const value = normalizeGridAnswer(event.target.value);
                      if (value.length > 1) updateGuess(value);
                      else if (value) writeLetter(value);
                    }}
                    maxLength={selectedWord.gridAnswer.length}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={state.solvedWordIds.includes(selectedWord.id) || state.status === "won"}
                    aria-describedby="answer-help"
                  />
                  <button type="submit" disabled={state.solvedWordIds.includes(selectedWord.id)}>
                    {state.solvedWordIds.includes(selectedWord.id) ? "Em tinta" : "Conferir"}
                  </button>
                </div>
                <small id="answer-help">Digite para preencher · Tab troca a palavra · Setas movem pelo caminho.</small>
              </form>
            ) : null}
          </section>

          <section className="inventory">
            <div className="inventory-heading"><span>MOCHILA</span><small>{inventoryTotal} achados</small></div>
            <div className="powerup-grid">
              {(Object.entries(POWERUP_DEFINITIONS) as Array<[PowerupType, (typeof POWERUP_DEFINITIONS)[PowerupType]]>).map(([type, meta]) => (
                <button
                  key={type}
                  type="button"
                  disabled={state.inventory[type] === 0 || (type !== "reveal-area" && type !== "objective-direction" && !selectedWord)}
                  onClick={() => usePowerup(type)}
                  title={`${meta.name}: ${meta.description}`}
                  aria-pressed={type === "reveal-letter" ? pendingLetterTarget : undefined}
                  className="has-sketch-frame"
                >
                  <SketchFrame seed={`mochila:${type}`} roughness={1.2} />
                  <PowerupGlyph powerupType={type} size={24} />
                  <b>{state.inventory[type]}</b><span>{meta.name}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>

      {state.lastFeedback ? (
        <div className={`feedback-toast ${state.lastFeedback.kind}`} role="status">
          {state.lastFeedback.message}
        </div>
      ) : null}
      {pendingLetterTarget ? (
        <div className="target-hint" role="status">
          <b>A·</b> Escolha no mapa uma célula da palavra aberta.
          <button type="button" onClick={() => setPendingLetterTarget(false)}>Cancelar</button>
        </div>
      ) : null}

      {tipVisible && state.status === "playing" ? (
        <aside className="field-tip has-sketch-frame">
          <SketchFrame seed="dica-de-campo" />
          <span>✎</span>
          <p><strong>Primeiro traço</strong>Comece a digitar. Tab troca de palavra e as setas movem o explorador pelos caminhos em tinta.</p>
          <button type="button" onClick={dismissTip} aria-label="Entendi">Entendi</button>
        </aside>
      ) : null}

      {settingsOpen ? (
        <aside className="settings-popover">
          <h2>Ajustes da expedição</h2>
          <label><span>Sons sutis</span><input type="checkbox" checked={soundsEnabled} onChange={(event) => {
            const enabled = event.target.checked;
            setSoundsEnabled(enabled);
            localStorage.setItem("cruzaverso:sounds", enabled ? "on" : "off");
            if (enabled) playSound("open", soundVolume);
          }} /></label>
          <label className="volume-control"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={soundVolume} onChange={(event) => {
            const volume = Number(event.target.value);
            setSoundVolume(volume);
            localStorage.setItem("cruzaverso:volume", String(volume));
          }} /></label>
          <label title="Sem conta, fingerprint ou conteúdo dos palpites"><span>Métricas anônimas</span><input type="checkbox" checked={telemetryEnabled} onChange={(event) => setTelemetry(event.target.checked)} /></label>
          <button type="button" className="text-button" disabled={state.status === "won"} onClick={resetDraft}>Apagar rascunho desta run</button>
          <button type="button" className="text-button" onClick={() => setSettingsOpen(false)}>Fechar</button>
        </aside>
      ) : null}

      {summaryOpen && state.status === "won" ? (
        <div className="summary-backdrop" role="dialog" aria-modal="true" aria-labelledby="summary-title">
          <section className="summary-card has-sketch-frame">
            <SketchFrame seed={map.id} roughness={2.4} />
            <span className="summary-compass">✣</span>
            <p className="eyebrow">EXPEDIÇÃO CONCLUÍDA</p>
            <h1 id="summary-title">O mapa se abriu.</h1>
            <p>Você encontrou uma saída do Cruzaverso de hoje. Todo o atlas e suas respostas agora estão visíveis.</p>
            <div className="summary-stats">
              <span><b>{state.solvedWordIds.length}</b> palavras em tinta</span>
              <span><b>{state.keysCollected}</b> chaves encontradas</span>
              <span><b>{formatActiveTime(state.activeMs)}</b> tempo ativo</span>
              <span><b>{state.captures}</b> áreas capturadas</span>
              <span><b>{state.powerupsUsed}</b> powerups usados</span>
              <span><b>{Math.max(0, state.path.length - 1)}</b> células no trajeto</span>
            </div>
            <button type="button" onClick={() => setSummaryOpen(false)}>Revelar atlas completo</button>
            <small>Uma nova expedição nasce amanhã, no horário de São Paulo.</small>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export { loadSavedState };
