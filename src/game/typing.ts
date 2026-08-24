export interface TypingSlots {
  readonly ink: readonly boolean[];
  readonly pencil: readonly boolean[];
}

/**
 * Sem lápis na palavra o cursor começa na primeira casa, mesmo que ela esteja
 * em tinta: quem chega numa palavra intacta digita a resposta inteira, e é a
 * tecla engolida sobre a tinta que mantém o alinhamento. Com lápis já escrito,
 * o jogador está retomando, então o cursor vai para a primeira casa vazia.
 */
export function entryIndexForWord(slots: TypingSlots): number {
  const hasPencil = slots.pencil.some(Boolean);
  if (!hasPencil) return 0;
  const firstEmpty = slots.ink.findIndex((inked, index) => !inked && !slots.pencil[index]);
  return firstEmpty >= 0 ? firstEmpty : Math.max(0, slots.ink.length - 1);
}

function clamp(index: number, length: number): number {
  if (index < 0) return 0;
  if (index > length - 1) return Math.max(0, length - 1);
  return index;
}

export function typeAt(
  slots: TypingSlots,
  index: number,
): { writeIndex: number | null; nextIndex: number } {
  const length = slots.ink.length;
  if (length === 0) return { writeIndex: null, nextIndex: 0 };
  const current = clamp(index, length);
  const nextIndex = clamp(current + 1, length);
  if (slots.ink[current]) return { writeIndex: null, nextIndex };
  return { writeIndex: current, nextIndex };
}

export function eraseAt(
  slots: TypingSlots,
  index: number,
): { eraseIndex: number | null; nextIndex: number } {
  const length = slots.ink.length;
  if (length === 0) return { eraseIndex: null, nextIndex: 0 };
  const current = clamp(index, length);
  if (slots.pencil[current]) return { eraseIndex: current, nextIndex: current };
  if (current === 0) return { eraseIndex: null, nextIndex: 0 };
  const previous = current - 1;
  if (slots.pencil[previous]) return { eraseIndex: previous, nextIndex: previous };
  return { eraseIndex: null, nextIndex: previous };
}
