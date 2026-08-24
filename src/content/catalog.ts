import { z } from "zod";

import { stableFingerprint } from "../shared/fingerprint.js";

export const BIOMES = [
  "cotidiano",
  "ciencia",
  "historia",
  "cultura-pop",
  "natureza",
  "brasil",
] as const;
export type BiomeId = (typeof BIOMES)[number];

export const CLUE_STYLES = [
  "definition",
  "elliptical",
  "association",
  "fill-blank",
  "wordplay",
  "trivia",
] as const;
export type ClueStyle = (typeof CLUE_STYLES)[number];

const authoredClueSchema = z.object({
  text: z.string().min(4),
  style: z.enum(CLUE_STYLES),
  difficulty: z.number().int().min(1).max(5),
});

const clueInputSchema = z.union([z.string().min(4), authoredClueSchema]);

const contentReferenceSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  license: z.string().min(1),
  role: z.enum(["lexical", "orthographic", "factual", "frequency"]),
});

const contentEntrySchema = z.object({
  id: z.string().min(1),
  answer: z.string().min(3),
  biomes: z.array(z.enum(BIOMES)).min(1),
  difficulty: z.number().int().min(1).max(5),
  familiarity: z.number().int().min(1).max(5),
  clues: z.object({
    normal: clueInputSchema,
    simple: clueInputSchema,
  }),
  provenance: z.object({
    source: z.string().min(1),
    license: z.string().min(1),
    sourceId: z.string().optional(),
    references: z.array(contentReferenceSchema).optional().default([]),
  }),
  tags: z.array(z.string()).optional().default([]),
});

export type ContentEntryInput = z.input<typeof contentEntrySchema>;
export type ContentReference = z.output<typeof contentReferenceSchema>;
export type AuthoredClue = z.output<typeof authoredClueSchema>;
export type ContentEntry = Omit<z.output<typeof contentEntrySchema>, "clues"> & {
  gridAnswer: string;
  clues: {
    normal: string;
    simple: string;
  };
  clueMeta: {
    normal: AuthoredClue;
    simple: AuthoredClue;
  };
};

export interface ContentCatalog {
  datasetVersion: string;
  /** Identidade do conteúdo jogável, independente da etiqueta editorial. */
  contentFingerprint: string;
  entries: ContentEntry[];
  byBiome: Record<BiomeId, ContentEntry[]>;
  findCrossings(letter: string, position: number): ContentEntry[];
  findByLetter(letter: string): Array<{ entry: ContentEntry; positions: number[] }>;
  findByBiomeLetter(
    biome: BiomeId,
    letter: string,
  ): Array<{ entry: ContentEntry; positions: number[] }>;
}

export function normalizeGridAnswer(answer: string): string {
  return answer
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function buildContentCatalog(
  input: ContentEntryInput[],
  datasetVersion = "unversioned",
): ContentCatalog {
  const seenAnswers = new Map<string, string>();
  const byBiome = {} as Record<BiomeId, ContentEntry[]>;
  for (const biome of BIOMES) byBiome[biome] = [];
  const positionIndex = new Map<string, ContentEntry[]>();
  const letterIndex = new Map<string, Map<string, { entry: ContentEntry; positions: number[] }>>();
  const biomeLetterIndex = new Map<
    BiomeId,
    Map<string, Map<string, { entry: ContentEntry; positions: number[] }>>
  >();
  for (const biome of BIOMES) biomeLetterIndex.set(biome, new Map());

  const entries = input.map((candidate) => {
    const parsed = contentEntrySchema.parse(candidate);
    const gridAnswer = normalizeGridAnswer(parsed.answer);

    if (gridAnswer.length < 3 || gridAnswer.length > 18) {
      throw new Error(`Resposta ${parsed.id} precisa ter entre 3 e 18 células`);
    }

    const duplicate = seenAnswers.get(gridAnswer);
    if (duplicate) {
      throw new Error(`Resposta duplicada ${gridAnswer}: ${duplicate} e ${parsed.id}`);
    }
    seenAnswers.set(gridAnswer, parsed.id);

    const authoredClue = (
      clue: z.output<typeof clueInputSchema>,
      fallbackDifficulty: number,
    ): AuthoredClue =>
      typeof clue === "string"
        ? { text: clue, style: "definition", difficulty: fallbackDifficulty }
        : clue;
    const normal = authoredClue(parsed.clues.normal, parsed.difficulty);
    const simple = authoredClue(parsed.clues.simple, Math.max(1, parsed.difficulty - 1));
    if (normal.text.trim() === simple.text.trim()) {
      throw new Error(`Pistas normal e simples repetidas em ${parsed.id}`);
    }
    if (normal.style === "wordplay" && !normal.text.trim().endsWith("?")) {
      throw new Error(`Pista de jogo de palavras sem interrogação em ${parsed.id}`);
    }

    return {
      ...parsed,
      gridAnswer,
      clues: { normal: normal.text, simple: simple.text },
      clueMeta: { normal, simple },
    };
  });

  for (const entry of entries) {
    for (const biome of entry.biomes) {
      byBiome[biome].push(entry);
    }

    for (const [position, letter] of [...entry.gridAnswer].entries()) {
      const positionKey = `${letter}:${position}`;
      const atPosition = positionIndex.get(positionKey) ?? [];
      atPosition.push(entry);
      positionIndex.set(positionKey, atPosition);

      const perLetter = letterIndex.get(letter) ?? new Map();
      const indexed = perLetter.get(entry.id) ?? { entry, positions: [] };
      indexed.positions.push(position);
      perLetter.set(entry.id, indexed);
      letterIndex.set(letter, perLetter);

      for (const biome of entry.biomes) {
        const perBiome = biomeLetterIndex.get(biome) as Map<
          string,
          Map<string, { entry: ContentEntry; positions: number[] }>
        >;
        const biomePerLetter = perBiome.get(letter) ?? new Map();
        const biomeIndexed = biomePerLetter.get(entry.id) ?? { entry, positions: [] };
        biomeIndexed.positions.push(position);
        biomePerLetter.set(entry.id, biomeIndexed);
        perBiome.set(letter, biomePerLetter);
      }
    }
  }

  const contentFingerprint = stableFingerprint(
    JSON.stringify(
      entries.map((entry) => ({
        id: entry.id,
        answer: entry.answer,
        gridAnswer: entry.gridAnswer,
        biomes: entry.biomes,
        difficulty: entry.difficulty,
        familiarity: entry.familiarity,
        clues: entry.clues,
        clueMeta: entry.clueMeta,
        tags: entry.tags,
      })),
    ),
  );

  return {
    datasetVersion,
    contentFingerprint,
    entries,
    byBiome,
    findCrossings(letter, position) {
      return positionIndex.get(`${normalizeGridAnswer(letter)}:${position}`) ?? [];
    },
    findByLetter(letter) {
      return [...(letterIndex.get(normalizeGridAnswer(letter))?.values() ?? [])];
    },
    findByBiomeLetter(biome, letter) {
      return [
        ...(biomeLetterIndex.get(biome)?.get(normalizeGridAnswer(letter))?.values() ?? []),
      ];
    },
  };
}
