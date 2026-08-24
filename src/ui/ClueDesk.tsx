import { normalizeGridAnswer } from "../content/catalog.js";
import type { GameState } from "../game/state.js";
import { cellsForWord, coordinateKey, type PlacedWord } from "../generation/types.js";
import { SketchFrame } from "./SketchFrame.js";

interface ClueDeskProps {
  state: GameState;
  wordsAvailable: PlacedWord[];
  selectedWord: PlacedWord | null;
  selectedWordId: string | null;
  activeCellIndex: number;
  onSelectWord: (wordId: string) => void;
  onFocusCell: (index: number) => void;
  onSubmit: (wordId: string) => void;
  onWriteLetter: (letter: string) => void;
  onGuess: (value: string) => void;
}

export function ClueDesk({
  state,
  wordsAvailable,
  selectedWord,
  selectedWordId,
  activeCellIndex,
  onSelectWord,
  onFocusCell,
  onSubmit,
  onWriteLetter,
  onGuess,
}: ClueDeskProps) {
  const selectedCells = selectedWord ? cellsForWord(selectedWord) : [];
  const selectedSolved = selectedWord ? state.solvedWordIds.includes(selectedWord.id) : false;

  return (
    <>
      <div className="clue-tabs" role="list" aria-label="Pistas disponíveis">
        {wordsAvailable.map((word, index) => {
          const wordSolved = state.solvedWordIds.includes(word.id);
          return (
            <button
              type="button"
              role="listitem"
              key={word.id}
              data-word-id={word.id}
              className={`has-sketch-frame ${word.id === selectedWordId ? "active" : ""} ${wordSolved ? "solved" : ""}`}
              onClick={() => onSelectWord(word.id)}
              title={wordSolved ? word.answer : word.clues.normal}
            >
              <SketchFrame seed={`aba:${word.id}`} roughness={1.1} />
              <b>{index + 1}</b>
              <span>{wordSolved ? word.answer : `${word.gridAnswer.length} letras`}</span>
              <i>{word.orientation === "horizontal" ? "→" : "↓"}</i>
            </button>
          );
        })}
      </div>

      <section className="current-clue has-sketch-frame" aria-live="polite">
        <SketchFrame seed={selectedWord?.id ?? "pista"} />
        <span className={`biome-stamp biome-${selectedWord?.biome ?? "cotidiano"}`}>
          {selectedWord?.biome.replace("-", " ") ?? "fronteira"}
        </span>
        {selectedWord ? (
          <>
            <p className="clue-line">
              <small>PISTA</small>
              {selectedWord.clues.normal}
            </p>
            {/* A pista comprada entra abaixo da original; substituir apagaria o
                enunciado que o jogador já estava lendo. */}
            {state.simplifiedWordIds.includes(selectedWord.id) ? (
              <p className="clue-line is-extra">
                <small>PISTA EXTRA</small>
                {selectedWord.clues.simple}
              </p>
            ) : null}
          </>
        ) : (
          <p className="clue-line">Escolha uma trilha no mapa.</p>
        )}
        {selectedWord ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(selectedWord.id);
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
                const hinted = state.hintedCellKeys.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`answer-slot has-sketch-frame ${index === activeCellIndex ? "active" : ""} ${inInk ? "in-ink" : ""} ${hinted ? "is-hinted" : ""}`}
                    onClick={() => {
                      if (!inInk && !selectedSolved) onFocusCell(index);
                      document.querySelector<HTMLInputElement>("#answer-input")?.focus();
                    }}
                    aria-label={`Letra ${index + 1}${value ? `: ${value}` : ": vazia"}`}
                  >
                    <SketchFrame seed={`slot:${selectedWord.id}:${index}`} roughness={0.9} />
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
                  if (value.length > 1) onGuess(value);
                  else if (value) onWriteLetter(value);
                }}
                maxLength={selectedWord.gridAnswer.length}
                autoComplete="off"
                spellCheck={false}
                disabled={selectedSolved || state.status === "won"}
                aria-describedby="answer-help"
              />
              <button type="submit" disabled={selectedSolved}>
                {selectedSolved ? "Em tinta" : "Conferir"}
              </button>
            </div>
            <small id="answer-help">
              Digite para preencher · Tab troca a palavra · Setas movem pelo caminho.
            </small>
          </form>
        ) : null}
      </section>
    </>
  );
}
