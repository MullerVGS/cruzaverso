import { BIOMES, CLUE_STYLES, normalizeGridAnswer } from "../src/content/catalog.js";
import { loadBundledCatalog } from "../src/content/bundled.js";

const catalog = loadBundledCatalog();
const errors: string[] = [];
const warnings: string[] = [];
const sourceSignatures = new Map<string, string>();
const seenNormalClues = new Map<string, string>();
const seenSimpleClues = new Map<string, string>();

if (catalog.entries.length !== 1_500) {
  errors.push(`Catálogo tem ${catalog.entries.length} entradas; esperado: 1500`);
}

for (const biome of BIOMES) {
  const entries = catalog.byBiome[biome];
  if (entries.length !== 250) errors.push(`${biome} tem ${entries.length} entradas; esperado: 250`);
  const styles = new Set(entries.map((entry) => entry.clueMeta.normal.style));
  if (styles.size < 3) warnings.push(`${biome} usa somente ${styles.size} estilos de pista`);
  const short = entries.filter((entry) => entry.gridAnswer.length <= 5).length;
  if (short < 20) warnings.push(`${biome} tem somente ${short} respostas de 3–5 células`);
}

for (const entry of catalog.entries) {
  const normalClueKey = entry.clues.normal.trim().toLocaleLowerCase("pt-BR");
  const simpleClueKey = entry.clues.simple.trim().toLocaleLowerCase("pt-BR");
  const duplicateNormal = seenNormalClues.get(normalClueKey);
  const duplicateSimple = seenSimpleClues.get(simpleClueKey);
  if (duplicateNormal) {
    errors.push(`${entry.id} repete a pista principal de ${duplicateNormal}`);
  }
  if (duplicateSimple) {
    errors.push(`${entry.id} repete a pista alternativa de ${duplicateSimple}`);
  }
  seenNormalClues.set(normalClueKey, entry.id);
  seenSimpleClues.set(simpleClueKey, entry.id);

  if (entry.biomes.length !== 1) errors.push(`${entry.id} precisa de um bioma editorial primário`);
  if (entry.provenance.references.length === 0) errors.push(`${entry.id} não cita fonte`);
  if (entry.clueMeta.normal.style === "definition") {
    warnings.push(`${entry.id} manteve definição como pista principal`);
  }
  if (entry.clueMeta.simple.style !== "definition") {
    errors.push(`${entry.id} não usa definição como pista alternativa`);
  }
  if (entry.clueMeta.simple.difficulty > entry.clueMeta.normal.difficulty) {
    errors.push(`${entry.id} tem pista alternativa mais difícil que a principal`);
  }
  if (
    entry.clueMeta.normal.style === "fill-blank" &&
    !/_{2,}|\u2026|\.{3}/u.test(entry.clues.normal)
  ) {
    errors.push(`${entry.id} marca fill-blank sem lacuna visível`);
  }
  const normalizedAnswer = normalizeGridAnswer(entry.answer);
  if (normalizedAnswer.length >= 5) {
    const normalizedNormal = normalizeGridAnswer(entry.clues.normal);
    const normalizedSimple = normalizeGridAnswer(entry.clues.simple);
    if (normalizedNormal.includes(normalizedAnswer)) {
      errors.push(`${entry.id} revela a resposta na pista principal`);
    }
    if (normalizedSimple.includes(normalizedAnswer)) {
      errors.push(`${entry.id} revela a resposta na pista alternativa`);
    }
  }

  for (const reference of entry.provenance.references) {
    const signature = JSON.stringify({
      title: reference.title,
      url: reference.url,
      license: reference.license,
      role: reference.role,
    });
    const existing = sourceSignatures.get(reference.sourceId);
    if (existing && existing !== signature) {
      errors.push(`Fonte ${reference.sourceId} tem metadados inconsistentes`);
    }
    sourceSignatures.set(reference.sourceId, signature);
  }
}

const byBiome = Object.fromEntries(
  BIOMES.map((biome) => {
    const entries = catalog.byBiome[biome];
    return [
      biome,
      {
        entries: entries.length,
        lengths: {
          short3to5: entries.filter((entry) => entry.gridAnswer.length <= 5).length,
          central6to10: entries.filter(
            (entry) => entry.gridAnswer.length >= 6 && entry.gridAnswer.length <= 10,
          ).length,
          long11to18: entries.filter((entry) => entry.gridAnswer.length >= 11).length,
        },
        styles: Object.fromEntries(
          CLUE_STYLES.map((style) => [
            style,
            entries.filter((entry) => entry.clueMeta.normal.style === style).length,
          ]),
        ),
        difficulty: Object.fromEntries(
          [1, 2, 3, 4, 5].map((difficulty) => [
            difficulty,
            entries.filter((entry) => entry.difficulty === difficulty).length,
          ]),
        ),
        familiarity: Object.fromEntries(
          [1, 2, 3, 4, 5].map((familiarity) => [
            familiarity,
            entries.filter((entry) => entry.familiarity === familiarity).length,
          ]),
        ),
        sources: new Set(
          entries.flatMap((entry) =>
            entry.provenance.references.map((reference) => reference.sourceId),
          ),
        ).size,
      },
    ];
  }),
);

process.stdout.write(
  `${JSON.stringify(
    {
      valid: errors.length === 0,
      entries: catalog.entries.length,
      sources: sourceSignatures.size,
      byBiome,
      errors,
      warnings: warnings.slice(0, 100),
      warningCount: warnings.length,
    },
    null,
    2,
  )}\n`,
);

if (errors.length > 0) process.exitCode = 1;
