import { coordinateKey, parseCoordinateKey, type PlacedWord } from "../generation/types.js";

/**
 * Numeração de palavra cruzada: quem manda é a casa em que a palavra começa.
 * As casas iniciais distintas são ordenadas em leitura — de cima para baixo, da
 * esquerda para a direita — e numeradas a partir de 1, então uma vertical e uma
 * horizontal que partem da mesma casa dividem o número, como em jornal.
 *
 * Deriva só do mapa. É isso que deixa o número estável enquanto a fronteira
 * cresce e permite que ele case com o número pintado na casa inicial.
 */
export function numberWords(words: readonly PlacedWord[]): Map<string, number> {
  const starts = [...new Set(words.map((word) => coordinateKey(word.start)))]
    .map((key) => ({ key, ...parseCoordinateKey(key) }))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const numberByStart = new Map(starts.map((start, index) => [start.key, index + 1]));
  return new Map(
    words.map((word) => [word.id, numberByStart.get(coordinateKey(word.start)) as number]),
  );
}
