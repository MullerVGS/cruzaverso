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
import { POWERUP_DEFINITIONS } from "../config/game.js";
import { sendTelemetry } from "./api.js";
import { MapView } from "./MapView.js";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(state.status === "won");
  const [soundsEnabled, setSoundsEnabled] = useState(
    () => localStorage.getItem("cruzaverso:sounds") !== "off",
  );
  const [telemetryEnabled, setTelemetryEnabled] = useState(
    () => localStorage.getItem("cruzaverso:telemetry") !== "off",
  );
  const [tipVisible, setTipVisible] = useState(
    () => localStorage.getItem("cruzaverso:tutorial-seen") !== "yes",
  );
  const runId = useMemo(() => getRunId(map), [map]);
  const startedTelemetry = useRef(false);

  const wordsAvailable = useMemo(() => availableWords(map, state), [map, state]);
  const availableIds = useMemo(
    () => new Set(wordsAvailable.map((word) => word.id)),
    [wordsAvailable],
  );
  const selectedWord = map.words.find((word) => word.id === selectedWordId) ?? null;

  useEffect(() => {
    if (!selectedWordId || !availableIds.has(selectedWordId)) {
      const frontier = wordsAvailable.find((word) => !state.solvedWordIds.includes(word.id));
      setSelectedWordId(frontier?.id ?? wordsAvailable[0]?.id ?? null);
    }
  }, [availableIds, selectedWordId, state.solvedWordIds, wordsAvailable]);

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
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        setState((current) => applyGameAction(map, current, { type: "add-active-time", milliseconds: 1_000 }));
      }
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [map]);

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
    const next = applyGameAction(map, state, action);
    if (next === state) return;
    emitTelemetry(state, next, action);
    if (next.status === "won" && state.status !== "won") {
      playSound("victory", soundsEnabled);
      setSummaryOpen(true);
    } else if (next.keysCollected > state.keysCollected || next.collectedObjectIds.length > state.collectedObjectIds.length) {
      playSound("collect", soundsEnabled);
    } else if (next.solvedWordIds.length > state.solvedWordIds.length) {
      playSound("solve", soundsEnabled);
    } else if (next.lastFeedback?.kind === "blocked") {
      playSound("blocked", soundsEnabled);
    }
    setState(next);
  }

  function updateGuess(value: string) {
    if (!selectedWord || state.solvedWordIds.includes(selectedWord.id)) return;
    const normalized = normalizeGridAnswer(value).slice(0, selectedWord.gridAnswer.length);
    let next = state;
    for (const [index, cell] of cellsForWord(selectedWord).entries()) {
      next = applyGameAction(map, next, {
        type: "write-cell",
        position: cell,
        letter: normalized[index] ?? "",
      });
    }
    setState(next);
    playSound("write", soundsEnabled);
  }

  function guessFor(word: PlacedWord): string {
    return cellsForWord(word)
      .map((cell) => state.ink[coordinateKey(cell)] ?? state.pencil[coordinateKey(cell)] ?? "")
      .join("");
  }

  function handleCellClick(position: Coordinate, words: PlacedWord[]) {
    const solvedHere = words.some((word) => state.solvedWordIds.includes(word.id));
    if (solvedHere) {
      perform({ type: "move", destination: position });
      return;
    }
    const candidates = words.filter((word) => availableIds.has(word.id));
    if (candidates.length === 0) return;
    const currentIndex = candidates.findIndex((word) => word.id === selectedWordId);
    const next = candidates[(currentIndex + 1) % candidates.length] ?? candidates[0];
    setSelectedWordId(next?.id ?? null);
  }

  function usePowerup(powerupType: PowerupType) {
    perform({
      type: "use-powerup",
      powerupType,
      wordId: selectedWord?.id,
    });
  }

  function resetDraft() {
    if (state.status === "won") return;
    const fresh = createInitialGameState(map);
    setState(fresh);
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
        <div className="objective-strip" aria-label="Objetivo da expedição">
          <span className="objective-icon">⌘</span>
          <span><small>OBJETIVO</small><strong>Encontre 2 chaves e alcance a saída</strong></span>
          <b>{Math.min(state.keysCollected, 2)}<i>/2</i></b>
        </div>
        <div className="header-actions">
          <span className="active-time" title="Tempo ativo nesta expedição">◷ {formatActiveTime(state.activeMs)}</span>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Abrir ajustes">⚙</button>
        </div>
      </header>

      <section className="game-layout">
        <MapView
          map={map}
          state={state}
          selectedWordId={selectedWordId}
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
                className={`${word.id === selectedWordId ? "active" : ""} ${state.solvedWordIds.includes(word.id) ? "solved" : ""}`}
                onClick={() => setSelectedWordId(word.id)}
                title={state.solvedWordIds.includes(word.id) ? word.answer : word.clues.normal}
              >
                <b>{index + 1}</b>
                <span>{state.solvedWordIds.includes(word.id) ? word.answer : `${word.gridAnswer.length} letras`}</span>
                <i>{word.orientation === "horizontal" ? "→" : "↓"}</i>
              </button>
            ))}
          </div>

          <section className="current-clue" aria-live="polite">
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
                <label htmlFor="answer-input">Seu palpite</label>
                <div className="answer-line">
                  <input
                    id="answer-input"
                    data-selected-word-id={selectedWord.id}
                    value={guessFor(selectedWord)}
                    onChange={(event) => updateGuess(event.target.value)}
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
                <small id="answer-help">Enter confere a palavra inteira. Tentativas ficam a lápis.</small>
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
                >
                  <i>{meta.icon}</i><b>{state.inventory[type]}</b><span>{meta.name}</span>
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

      {tipVisible && state.status === "playing" ? (
        <aside className="field-tip">
          <span>✎</span>
          <p><strong>Primeiro traço</strong>Escolha uma pista e escreva sem medo. A primeira palavra certa abre uma grande área ao redor do ponto de partida.</p>
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
            if (enabled) playSound("open", true);
          }} /></label>
          <label title="Sem conta, fingerprint ou conteúdo dos palpites"><span>Métricas anônimas</span><input type="checkbox" checked={telemetryEnabled} onChange={(event) => setTelemetry(event.target.checked)} /></label>
          <button type="button" className="text-button" disabled={state.status === "won"} onClick={resetDraft}>Apagar rascunho desta run</button>
          <button type="button" className="text-button" onClick={() => setSettingsOpen(false)}>Fechar</button>
        </aside>
      ) : null}

      {summaryOpen && state.status === "won" ? (
        <div className="summary-backdrop" role="dialog" aria-modal="true" aria-labelledby="summary-title">
          <section className="summary-card">
            <span className="summary-compass">✣</span>
            <p className="eyebrow">EXPEDIÇÃO CONCLUÍDA</p>
            <h1 id="summary-title">O mapa se abriu.</h1>
            <p>Você encontrou uma saída do Cruzaverso de hoje. Todo o atlas e suas respostas agora estão visíveis.</p>
            <div className="summary-stats">
              <span><b>{state.solvedWordIds.length}</b> palavras em tinta</span>
              <span><b>{state.keysCollected}</b> chaves encontradas</span>
              <span><b>{formatActiveTime(state.activeMs)}</b> tempo ativo</span>
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
