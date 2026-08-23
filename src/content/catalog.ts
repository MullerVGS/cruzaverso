import { z } from "zod";

export const BIOMES = ["cotidiano", "ciencia", "historia", "cultura-pop"] as const;
export type BiomeId = (typeof BIOMES)[number];

const contentEntrySchema = z.object({
  id: z.string().min(1),
  answer: z.string().min(3),
  biomes: z.array(z.enum(BIOMES)).min(1),
  difficulty: z.number().int().min(1).max(5),
  familiarity: z.number().int().min(1).max(5),
  clues: z.object({
    normal: z.string().min(4),
    simple: z.string().min(4),
  }),
  provenance: z.object({
    source: z.string().min(1),
    license: z.string().min(1),
    sourceId: z.string().optional(),
  }),
  tags: z.array(z.string()).optional().default([]),
});

export type ContentEntryInput = z.input<typeof contentEntrySchema>;
export type ContentEntry = z.output<typeof contentEntrySchema> & {
  gridAnswer: string;
};

export interface ContentCatalog {
  entries: ContentEntry[];
  byBiome: Record<BiomeId, ContentEntry[]>;
  findCrossings(letter: string, position: number): ContentEntry[];
  findByLetter(letter: string): Array<{ entry: ContentEntry; positions: number[] }>;
}

export function normalizeGridAnswer(answer: string): string {
  return answer
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function buildContentCatalog(input: ContentEntryInput[]): ContentCatalog {
  const seenAnswers = new Map<string, string>();
  const byBiome: Record<BiomeId, ContentEntry[]> = {
    cotidiano: [],
    ciencia: [],
    historia: [],
    "cultura-pop": [],
  };
  const positionIndex = new Map<string, ContentEntry[]>();
  const letterIndex = new Map<string, Map<string, { entry: ContentEntry; positions: number[] }>>();

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

    return { ...parsed, gridAnswer };
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
    }
  }

  return {
    entries,
    byBiome,
    findCrossings(letter, position) {
      return positionIndex.get(`${normalizeGridAnswer(letter)}:${position}`) ?? [];
    },
    findByLetter(letter) {
      return [...(letterIndex.get(normalizeGridAnswer(letter))?.values() ?? [])];
    },
  };
}
