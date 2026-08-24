import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyGameAction,
  availableWords,
  createInitialGameState,
  type GameAction,
  type GameState,
} from "../game/state.js";
import { numberWords } from "../game/numbering.js";
import { entryIndexForWord, eraseAt, typeAt } from "../game/typing.js";
import {
  cellsForWord,
  coordinateKey,
  type Coordinate,
  type DailyMap,
  type PlacedWord,
} from "../generation/types.js";
import { normalizeGridAnswer } from "../content/catalog.js";
import { GAME_BALANCE, ITEM_DEFINITIONS } from "../config/game.js";
import { sendTelemetry } from "./api.js";
import { ClueDesk } from "./ClueDesk.js";
import { ItemGlyph } from "./ItemGlyph.js";
import { MapView } from "./MapView.js";
import { Shop } from "./Shop.js";
import { SketchFrame } from "./SketchFrame.js";
import { useArmedItem } from "./useArmedItem.js";
import { playSound } from "./sfx.js";

function saveKey(map: DailyMap): string {
  return `cruzaverso:save:${map.id}`;
}

function loadSavedState(map: DailyMap): GameState | null {
  try {
    const raw = localStorage.getItem(saveKey(map));
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    return state.schemaVersion === 2 && state.mapId === map.id ? state : null;
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

/** No modo livre a seed vem embrulhada como `cruzaverso:livre:<slug>:medium`. */
function freeSeedLabel(map: DailyMap): string {
  return map.seed.replace(/^cruzaverso:livre:/, "").replace(/:medium$/, "");
}

const AIM_INSTRUCTION = {
  cell: "clique numa casa vazia de uma palavra aberta",
  word: "clique numa palavra aberta",
  route: "clique numa rota avistada que ainda não abriu",
  instant: "",
} as const;

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
  const { armed, arm, disarm, targeting } = useArmedItem();
  const runId = useMemo(() => getRunId(map), [map]);
  const startedTelemetry = useRef(false);
  const lastActivityAt = useRef(Date.now());
  const activeCellIndexRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const soundLevel = soundsEnabled ? soundVolume : 0;

  const wordNumbers = useMemo(() => numberWords(map.words), [map]);
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
    setEntryCell(entryIndexForWord(slotsFor(selectedWord).slots));
  }, [selectedWordId]);

  const playerKey = coordinateKey(state.player);
  // Chegar andando numa casa muda o foco de pista. A dependência é só a posição
  // de propósito: qualquer outra mudança de estado não deve roubar o foco.
  useEffect(() => {
    const here = wordsAvailable.filter(
      (word) =>
        !state.solvedWordIds.includes(word.id) &&
        cellsForWord(word).some((cell) => coordinateKey(cell) === playerKey),
    );
    if (here.length === 0) return;
    const previous = map.words.find((word) => word.id === selectedWordId);
    const sameOrientation = here.find((word) => word.orientation === previous?.orientation);
    setSelectedWordId((sameOrientation ?? here[0])!.id);
  }, [playerKey]);

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
    if (action.type === "use-item" && next !== previous) {
      sendTelemetry(telemetryEnabled, {
        runId,
        mapId: map.id,
        event: "item_used",
        elapsedActiveMs: next.activeMs,
        payload: {
          itemType: action.item,
          credits: next.credits,
          creditsEarned: next.creditsEarned,
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

  /** Devolve se o item foi de fato cobrado, para a mira só desarmar quando aplica. */
  function perform(action: GameAction): boolean {
    const previous = stateRef.current;
    const next = applyGameAction(map, previous, action);
    if (next === previous) return false;
    emitTelemetry(previous, next, action);
    if (next.status === "won" && previous.status !== "won") {
      playSound("victory", soundLevel);
      setSummaryOpen(true);
    } else if (next.keysCollected > previous.keysCollected || next.collectedObjectIds.length > previous.collectedObjectIds.length) {
      playSound("collect", soundLevel);
    } else if (next.solvedWordIds.length > previous.solvedWordIds.length) {
      playSound("solve", soundLevel);
    } else if (next.lastFeedback?.kind === "blocked" || next.lastFeedback?.kind === "unavailable") {
      playSound("blocked", soundLevel);
    }
    commitState(next);
    return next.itemsUsed > previous.itemsUsed;
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
    // Mesma ordem da lista de duas colunas: verticais, depois horizontais, cada
    // uma pelo número. Percorrer a ordem do array contradiria o que está na tela.
    const candidates = wordsAvailable
      .filter((word) => !stateRef.current.solvedWordIds.includes(word.id))
      .sort(
        (left, right) =>
          Number(left.orientation === "horizontal") - Number(right.orientation === "horizontal") ||
          (wordNumbers.get(left.id) ?? 0) - (wordNumbers.get(right.id) ?? 0),
      );
    if (candidates.length === 0) return;
    const currentIndex = candidates.findIndex((word) => word.id === selectedWordId);
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : candidates.length - 1
      : (currentIndex + direction + candidates.length) % candidates.length;
    const next = candidates[nextIndex];
    if (next) setSelectedWordId(next.id);
  }

  function slotsFor(word: PlacedWord) {
    const cells = cellsForWord(word);
    return {
      cells,
      slots: {
        ink: cells.map((cell) => Boolean(stateRef.current.ink[coordinateKey(cell)])),
        pencil: cells.map((cell) => Boolean(stateRef.current.pencil[coordinateKey(cell)])),
      },
    };
  }

  function writeLetter(letter: string) {
    if (!selectedWord || stateRef.current.solvedWordIds.includes(selectedWord.id)) return;
    const { cells, slots } = slotsFor(selectedWord);
    const step = typeAt(slots, activeCellIndexRef.current);
    if (step.writeIndex !== null) {
      const cell = cells[step.writeIndex];
      if (cell) perform({ type: "write-cell", position: cell, letter });
    }
    setEntryCell(step.nextIndex);
  }

  function eraseLetter() {
    if (!selectedWord || stateRef.current.solvedWordIds.includes(selectedWord.id)) return;
    const { cells, slots } = slotsFor(selectedWord);
    const step = eraseAt(slots, activeCellIndexRef.current);
    if (step.eraseIndex !== null) {
      const cell = cells[step.eraseIndex];
      if (cell) perform({ type: "write-cell", position: cell, letter: "" });
    }
    setEntryCell(step.nextIndex);
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

  /**
   * Aplica o item armado no alvo clicado e devolve `true` quando o clique foi
   * consumido pela mira — inclusive num alvo inválido, para o clique não virar
   * movimento no meio de uma compra. O crédito só sai aqui, no reducer.
   */
  function applyArmedAt(position: Coordinate, words: PlacedWord[]): boolean {
    if (!armed) return false;
    if (targeting === "route") {
      // Mirar onde não há rota bloqueada não cobra: o reducer recusa e a mira
      // fica de pé para o jogador escolher outra em vez de perder o crédito.
      if (perform({ type: "use-item", item: armed, position })) disarm();
      return true;
    }
    if (targeting === "cell") {
      if (state.ink[coordinateKey(position)]) return true;
      const target = words.find(
        (word) => availableIds.has(word.id) && !state.solvedWordIds.includes(word.id),
      );
      if (!target) return true;
      if (perform({ type: "use-item", item: armed, position })) disarm();
      return true;
    }
    if (targeting === "word") {
      const target = words.find(
        (word) =>
          availableIds.has(word.id) &&
          !state.solvedWordIds.includes(word.id) &&
          !state.simplifiedWordIds.includes(word.id),
      );
      if (!target) return true;
      if (perform({ type: "use-item", item: armed, wordId: target.id })) disarm();
      return true;
    }
    return false;
  }

  function handleCellClick(position: Coordinate, words: PlacedWord[]) {
    if (applyArmedAt(position, words)) return;
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
    }
  }

  function resetDraft() {
    if (state.status === "won") return;
    const subject = map.mode === "daily" ? "a expedição de hoje" : "esta expedição livre";
    if (!window.confirm(`Apagar todos os traços e recomeçar ${subject}?`)) return;
    const fresh = createInitialGameState(map);
    commitState(fresh);
    setSelectedWordId(null);
    setSettingsOpen(false);
    disarm();
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

  const coinsTotal = map.objects.filter((object) => object.type === "coin").length;
  const coinsCollected = map.objects.filter(
    (object) => object.type === "coin" && state.collectedObjectIds.includes(object.id),
  ).length;

  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="wordmark" type="button" onClick={onBack} aria-label="Voltar ao início">
          <span className="wordmark-star">✣</span>
          <span>
            <strong>Cruzaverso</strong>
            <small>{map.mode === "daily" ? map.date.split("-").reverse().join(" · ") : freeSeedLabel(map)}</small>
          </span>
        </button>
        {map.objective.kind === "keys-and-exit" ? (
          <div className="objective-strip has-sketch-frame" aria-label="Objetivo da expedição">
            <SketchFrame seed="tarja-objetivo" />
            <span className="objective-icon">⌘</span>
            <span>
              <small>OBJETIVO</small>
              <strong>Encontre {map.objective.keysRequired} chaves e alcance a saída</strong>
            </span>
            <b>
              {Math.min(state.keysCollected, map.objective.keysRequired)}
              <i>/{map.objective.keysRequired}</i>
            </b>
          </div>
        ) : (
          <div className="objective-strip is-sandbox has-sketch-frame" aria-label="Progresso da expedição livre">
            <SketchFrame seed="tarja-livre" />
            <span className="objective-icon">✧</span>
            <span className="sandbox-tally">
              <span>
                <small>PALAVRAS</small>
                <strong>{state.solvedWordIds.length}/{map.words.length}</strong>
              </span>
              <span>
                <small>MOEDAS</small>
                <strong>{coinsCollected}/{coinsTotal}</strong>
              </span>
              <span>
                <small>CARTEIRA</small>
                <strong>⬡ {state.credits}</strong>
              </span>
            </span>
          </div>
        )}
        <div className="header-actions">
          {map.objective.kind === "keys-and-exit" ? (
            <span className="run-tally" title="Palavras em tinta">
              ◧ {state.solvedWordIds.length}/{map.words.length}
            </span>
          ) : null}
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
          wordNumbers={wordNumbers}
          armedTargeting={targeting}
          onCellClick={handleCellClick}
        />

        <aside className="clue-desk">
          <ClueDesk
            state={state}
            wordsAvailable={wordsAvailable}
          wordNumbers={wordNumbers}
            selectedWord={selectedWord}
            selectedWordId={selectedWordId}
            activeCellIndex={activeCellIndex}
            onSelectWord={setSelectedWordId}
            onFocusCell={setEntryCell}
            onSubmit={(wordId) => perform({ type: "submit-word", wordId })}
            onWriteLetter={writeLetter}
            onGuess={updateGuess}
          />

          <Shop
            credits={state.credits}
            armed={armed}
            disabled={state.status === "won"}
            onArm={arm}
            onUseInstant={(item) => perform({ type: "use-item", item })}
          />
        </aside>
      </section>

      {state.lastFeedback ? (
        <div className={`feedback-toast ${state.lastFeedback.kind}`} role="status">
          {state.lastFeedback.message}
        </div>
      ) : null}
      {armed && targeting ? (
        <div className="armed-banner" role="status">
          <ItemGlyph item={armed} size={20} />
          <span>
            <strong>{ITEM_DEFINITIONS[armed].name}</strong>
            {AIM_INSTRUCTION[targeting]}
          </span>
          <b>⬡ {ITEM_DEFINITIONS[armed].price}</b>
          <button type="button" onClick={disarm}>Cancelar</button>
          <small>Esc ou botão direito cancelam sem cobrar.</small>
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
              <span><b>{state.itemsUsed}</b> itens comprados</span>
              <span><b>{Math.max(0, state.path.length - 1)}</b> células no trajeto</span>
              <span><b>{state.hintedCellKeys.length}</b> letras compradas</span>
              <span><b>{state.creditsEarned}</b> créditos ganhos</span>
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
