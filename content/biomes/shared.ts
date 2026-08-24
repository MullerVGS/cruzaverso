import type {
  BiomeId,
  ClueStyle,
  ContentEntryInput,
  ContentReference,
} from "../../src/content/catalog.js";
import { normalizeGridAnswer } from "../../src/content/catalog.js";

export interface EditorialSource extends ContentReference {}

export type EditorialRecord = readonly [
  answer: string,
  crosswordClue: string,
  directClue: string,
  clueStyle: Exclude<ClueStyle, "definition">,
  difficulty: 1 | 2 | 3 | 4 | 5,
  familiarity: 1 | 2 | 3 | 4 | 5,
  tags: readonly string[],
  sourceIds: readonly string[],
];

export interface BiomeBundle {
  biome: BiomeId;
  prefix: string;
  editorialSource: string;
  sources: readonly EditorialSource[];
  records: readonly EditorialRecord[];
}

export function entriesFromBundle(bundle: BiomeBundle): ContentEntryInput[] {
  if (bundle.records.length !== 250) {
    throw new Error(`Lote ${bundle.biome} tem ${bundle.records.length} registros; esperado: 250`);
  }

  const sourceById = new Map(bundle.sources.map((source) => [source.sourceId, source]));
  if (sourceById.size !== bundle.sources.length) {
    throw new Error(`Fontes duplicadas no lote ${bundle.biome}`);
  }

  const seenAnswers = new Set<string>();

  return bundle.records.map(
    ([answer, crosswordClue, directClue, clueStyle, difficulty, familiarity, tags, sourceIds]) => {
      const gridAnswer = normalizeGridAnswer(answer);
      if (seenAnswers.has(gridAnswer)) {
        throw new Error(`Resposta duplicada ${gridAnswer} no lote ${bundle.biome}`);
      }
      seenAnswers.add(gridAnswer);

      const references = sourceIds.map((sourceId) => {
        const source = sourceById.get(sourceId);
        if (!source) throw new Error(`Fonte ${sourceId} ausente no lote ${bundle.biome}`);
        return source;
      });
      if (references.length === 0) {
        throw new Error(`Resposta ${answer} sem referência editorial`);
      }

      return {
        id: `${bundle.prefix}-${gridAnswer.toLowerCase()}`,
        answer,
        biomes: [bundle.biome],
        difficulty,
        familiarity,
        clues: {
          normal: { text: crosswordClue, style: clueStyle, difficulty },
          simple: {
            text: directClue,
            style: "definition" as const,
            difficulty: Math.max(1, difficulty - 1),
          },
        },
        provenance: {
          source: bundle.editorialSource,
          license: "conteudo-original-do-projeto",
          references,
        },
        tags: [...tags],
      } satisfies ContentEntryInput;
    },
  );
}
