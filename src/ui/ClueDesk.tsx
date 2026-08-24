import { useEffect, useRef } from "react";

import { normalizeGridAnswer } from "../content/catalog.js";
import type { GameState } from "../game/state.js";
import { cellsForWord, coordinateKey, type PlacedWord } from "../generation/types.js";
import { SketchFrame } from "./SketchFrame.js";

interface ClueDeskProps {
  state: GameState;
  wordsAvailable: PlacedWord[];
  wordNumbers: Map<string, number>;
  hoveredWordId: string | null;
  onHoverWord: (wordId: string | null) => void;
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
  wordNumbers,
  hoveredWordId,
  onHoverWord,
  selectedWord,
  selectedWordId,
  activeCellIndex,
  onSelectWord,
  onFocusCell,
  onSubmit,
  onWriteLetter,
  onGuess,
}: ClueDeskProps) {
  const indexRef = useRef<HTMLDivElement>(null);

  // A rolagem automática só serve ao realce que vem do mapa. Rolar enquanto o
  // ponteiro está sobre a própria lista move outra entrada para debaixo dele,
  // que reacende o realce e rola de novo — laço que trava a aba.
  useEffect(() => {
    const lista = indexRef.current;
    if (!lista || !hoveredWordId || lista.matches(":hover")) return;
    lista
      .querySelector(`button[data-word-id="${hoveredWordId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [hoveredWordId]);

  const selectedCells = selectedWord ? cellsForWord(selectedWord) : [];
  const selectedSolved = selectedWord ? state.solvedWordIds.includes(selectedWord.id) : false;

  return (
    <>
      <div className="clue-index" ref={indexRef}>
        {(
          [
            ["vertical", "VERTICAIS", "↓"],
            ["horizontal", "HORIZONTAIS", "→"],
          ] as const
        ).map(([orientation, title, arrow]) => {
          const column = wordsAvailable
            .filter((word) => word.orientation === orientation)
            .sort((left, right) => (wordNumbers.get(left.id) ?? 0) - (wordNumbers.get(right.id) ?? 0));
          return (
            <div className="clue-column" key={orientation}>
              <h3>
                {title} <i>{arrow}</i>
              </h3>
              {column.length === 0 ? (
                <p className="clue-column-empty">nenhuma por enquanto</p>
              ) : (
                <ul role="list">
                  {column.map((word) => {
                    const wordSolved = state.solvedWordIds.includes(word.id);
                    return (
                      <li key={word.id}>
                        <button
                          type="button"
                          data-word-id={word.id}
                          data-word-number={wordNumbers.get(word.id)}
                          className={`${word.id === selectedWordId ? "active" : ""} ${wordSolved ? "solved" : ""} ${word.id === hoveredWordId ? "hovered" : ""}`}
                          onClick={() => onSelectWord(word.id)}
                          onPointerEnter={() => onHoverWord(word.id)}
                          onPointerLeave={() => onHoverWord(null)}
                          title={wordSolved ? word.answer : word.clues.normal}
                        >
                          <b>{wordNumbers.get(word.id)}</b>
                          <span>{wordSolved ? word.answer : `${word.gridAnswer.length} letras`}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
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
              {`${wordNumbers.get(selectedWord.id) ?? ""} ${selectedWord.orientation === "horizontal" ? "→ Horizontal" : "↓ Vertical"}`}
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
