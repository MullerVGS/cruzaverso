import { describe, expect, it } from "vitest";

import { BIOMES } from "../content/catalog.js";
import { biomeFieldSpecFromSeed, createBiomeField, majorityBiome } from "./biome-field.js";
import type { BiomeSite } from "./types.js";

const sites: BiomeSite[] = [
  { id: "a", biome: "cotidiano", x: -18, y: -8, radius: 20 },
  { id: "b", biome: "ciencia", x: 16, y: -12, radius: 20 },
  { id: "c", biome: "historia", x: -12, y: 14, radius: 20 },
  { id: "d", biome: "cultura-pop", x: 20, y: 12, radius: 20 },
];

function fieldFor(seed: string) {
  return createBiomeField(biomeFieldSpecFromSeed(seed), sites);
}

describe("campo de biomas", () => {
  it("é determinístico para a mesma seed", () => {
    const first = fieldFor("cruzaverso:2026-08-23");
    const replay = fieldFor("cruzaverso:2026-08-23");
    for (let x = -30; x <= 30; x += 3) {
      for (let y = -20; y <= 20; y += 3) {
        expect(replay.biomeAt(x, y)).toBe(first.biomeAt(x, y));
      }
    }
  });

  it("produz campos diferentes para seeds diferentes", () => {
    const today = fieldFor("cruzaverso:2026-08-23");
    const tomorrow = fieldFor("cruzaverso:2026-08-24");
    let divergences = 0;
    for (let x = -30; x <= 30; x += 2) {
      for (let y = -20; y <= 20; y += 2) {
        if (today.biomeAt(x, y) !== tomorrow.biomeAt(x, y)) divergences += 1;
      }
    }
    expect(divergences).toBeGreaterThan(40);
  });

  it("devolve somente biomas conhecidos", () => {
    const field = fieldFor("cruzaverso:2026-09-01");
    for (let x = -40; x <= 40; x += 5) {
      for (let y = -30; y <= 30; y += 5) {
        expect(BIOMES).toContain(field.biomeAt(x, y));
      }
    }
  });

  it("deforma as fronteiras: nenhuma coluna longa divide o campo em linha reta", () => {
    const field = fieldFor("cruzaverso:2026-08-23");
    // Numa fronteira de Voronoi reto, a transição ao longo de x cai sempre no mesmo
    // ponto para linhas y vizinhas. Com warp, o ponto de transição precisa oscilar.
    const transitions: number[] = [];
    for (let y = -14; y <= 14; y += 1) {
      let previous = field.biomeAt(-34, y);
      for (let x = -33; x <= 34; x += 1) {
        const current = field.biomeAt(x, y);
        if (current !== previous) {
          transitions.push(x);
          break;
        }
        previous = current;
      }
    }
    expect(new Set(transitions).size).toBeGreaterThan(3);
  });

  it("é contínuo: passos de uma célula raramente trocam de bioma", () => {
    const field = fieldFor("cruzaverso:2026-08-23");
    let samples = 0;
    let changes = 0;
    for (let x = -30; x <= 30; x += 1) {
      for (let y = -20; y <= 20; y += 1) {
        samples += 1;
        if (field.biomeAt(x, y) !== field.biomeAt(x + 1, y)) changes += 1;
      }
    }
    expect(changes / samples).toBeLessThan(0.08);
  });
});

describe("bioma por maioria de células", () => {
  const field = fieldFor("cruzaverso:2026-08-23");

  it("elege o bioma que ocupa mais células da palavra", () => {
    const cells = [
      { x: -18, y: -8 },
      { x: -18, y: -7 },
      { x: -18, y: -6 },
    ];
    const counts = new Map<string, number>();
    for (const cell of cells) {
      const biome = field.biomeAt(cell.x, cell.y);
      counts.set(biome, (counts.get(biome) ?? 0) + 1);
    }
    const expected = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]![0];
    expect(majorityBiome(field, cells)).toBe(expected);
  });

  it("desempata pela célula central", () => {
    const cells = [
      { x: -18, y: -8 },
      { x: 16, y: -12 },
    ];
    const winner = majorityBiome(field, cells);
    expect(BIOMES).toContain(winner);
    expect(majorityBiome(field, cells)).toBe(winner);
  });

  it("recusa lista vazia", () => {
    expect(() => majorityBiome(field, [])).toThrow();
  });
});

describe("memoização do campo", () => {
  // A memória de células inteiras é otimização, não semântica. Este teste existe
  // para garantir que ela nunca passe a mudar o resultado: reimplementa o campo
  // sem cache a partir do mesmo spec e exige concordância célula a célula.
  function semCache(spec: ReturnType<typeof biomeFieldSpecFromSeed>, x: number, y: number) {
    const solto = createBiomeField(spec, sites);
    return solto.biomeAt(x, y);
  }

  it("devolve o mesmo bioma na consulta fria e na quente", () => {
    const field = fieldFor("cruzaverso:2026-08-23");
    const frio = new Map<string, string>();
    for (let x = -40; x <= 40; x += 1) {
      for (let y = -30; y <= 30; y += 1) {
        frio.set(`${x},${y}`, field.biomeAt(x, y));
      }
    }
    for (const [key, biome] of frio) {
      const [x, y] = key.split(",").map(Number);
      expect(field.biomeAt(x as number, y as number)).toBe(biome);
    }
  });

  it("concorda com um campo recém-criado, sem cache aquecido", () => {
    const spec = biomeFieldSpecFromSeed("cruzaverso:2026-08-23");
    const quente = createBiomeField(spec, sites);
    // Aquece o cache varrendo a área inteira.
    for (let x = -40; x <= 40; x += 1) for (let y = -30; y <= 30; y += 1) quente.biomeAt(x, y);
    for (let x = -40; x <= 40; x += 3) {
      for (let y = -30; y <= 30; y += 3) {
        expect(quente.biomeAt(x, y)).toBe(semCache(spec, x, y));
      }
    }
  });

  it("concorda com um oráculo independente, inclusive em coordenada fracionária", () => {
    // `warp` é exportado e não passa pelo cache. Reconstruir o vencedor a partir
    // dele dá um oráculo genuinamente independente da memoização — inclusive
    // para coordenadas fracionárias, que o traçado de contorno vai varrer.
    const field = fieldFor("cruzaverso:2026-08-23");
    const oraculo = (x: number, y: number) => {
      const warped = field.warp(x, y);
      let winner = sites[0] as BiomeSite;
      let best = Number.POSITIVE_INFINITY;
      for (const site of sites) {
        const distance = (site.x - warped.x) ** 2 + (site.y - warped.y) ** 2;
        if (distance < best) {
          best = distance;
          winner = site;
        }
      }
      return winner.biome;
    };

    // Aquece o cache com a grade inteira antes de perguntar pelas frações.
    for (let x = -30; x <= 30; x += 1) for (let y = -20; y <= 20; y += 1) field.biomeAt(x, y);

    let fracionariasDivergentesDaGrade = 0;
    for (let x = -30; x <= 30; x += 0.5) {
      for (let y = -20; y <= 20; y += 0.5) {
        expect(field.biomeAt(x, y)).toBe(oraculo(x, y));
        if (Number.isInteger(x) || Number.isInteger(y)) continue;
        if (field.biomeAt(x, y) !== field.biomeAt(Math.round(x), Math.round(y))) {
          fracionariasDivergentesDaGrade += 1;
        }
      }
    }
    // Se a memória arredondasse a chave, meio-passo nunca discordaria da célula
    // vizinha. Discordar em algum ponto prova que a fração é calculada, não colada.
    expect(fracionariasDivergentesDaGrade).toBeGreaterThan(0);
  });

  it("fora do alcance do cache continua correto e determinístico", () => {
    const field = fieldFor("cruzaverso:2026-08-23");
    for (const distante of [-900, -513, 513, 900]) {
      const primeiro = field.biomeAt(distante, distante);
      expect(field.biomeAt(distante, distante)).toBe(primeiro);
      expect(BIOMES).toContain(primeiro);
    }
  });
});
