import { describe, expect, it } from "vitest";

import { entryIndexForWord, eraseAt, typeAt } from "./typing.js";

/** Simula digitar `typed` letra a letra e devolve a palavra montada. */
function playThrough(pattern: string, typed: string): string {
  const ink = [...pattern].map((char) => char !== "_");
  const slots = { ink, pencil: [...pattern].map(() => false) };
  const written = [...pattern];
  const pencil = [...pattern].map(() => false);
  let index = entryIndexForWord({ ink, pencil });
  for (const letter of typed) {
    const step = typeAt({ ink, pencil }, index);
    if (step.writeIndex !== null) {
      written[step.writeIndex] = letter;
      pencil[step.writeIndex] = true;
    }
    index = step.nextIndex;
  }
  return written.join("");
}

describe("cursor de digitação", () => {
  it("engole a tecla sobre letra em tinta em vez de pular a casa", () => {
    expect(playThrough("__R__", "CARRO")).toBe("CARRO");
  });

  it("aceita a palavra inteira quando a tinta está na primeira casa", () => {
    expect(playThrough("R___", "RATO")).toBe("RATO");
  });

  it("aceita a palavra inteira quando a tinta está na última casa", () => {
    expect(playThrough("___O", "RATO")).toBe("RATO");
  });

  it("começa na primeira casa quando não há lápis nenhum", () => {
    expect(entryIndexForWord({ ink: [true, false, false], pencil: [false, false, false] })).toBe(0);
  });

  it("retoma na primeira casa vazia quando já existe lápis", () => {
    expect(entryIndexForWord({ ink: [true, false, false], pencil: [false, true, false] })).toBe(2);
  });

  it("não passa do fim da palavra", () => {
    const slots = { ink: [false, false], pencil: [false, false] };
    expect(typeAt(slots, 1).nextIndex).toBe(1);
  });

  it("apaga no lugar quando a casa tem lápis", () => {
    const slots = { ink: [false, false, false], pencil: [true, true, false] };
    expect(eraseAt(slots, 1)).toEqual({ eraseIndex: 1, nextIndex: 1 });
  });

  it("recua e apaga quando a casa está vazia", () => {
    const slots = { ink: [false, false, false], pencil: [true, false, false] };
    expect(eraseAt(slots, 1)).toEqual({ eraseIndex: 0, nextIndex: 0 });
  });

  it("recua sem apagar quando a casa anterior está em tinta", () => {
    const slots = { ink: [true, false, false], pencil: [false, false, false] };
    expect(eraseAt(slots, 1)).toEqual({ eraseIndex: null, nextIndex: 0 });
  });

  it("não recua além da primeira casa", () => {
    const slots = { ink: [false, false], pencil: [false, false] };
    expect(eraseAt(slots, 0)).toEqual({ eraseIndex: null, nextIndex: 0 });
  });

  it("engole todas as teclas quando a palavra inteira está em tinta", () => {
    expect(playThrough("GATO", "GATO")).toBe("GATO");
  });
});
