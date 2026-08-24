import { describe, expect, it } from "vitest";

import { biomeFieldSpecFromSeed, createBiomeField } from "../generation/biome-field.js";
import type { BiomeSite } from "../generation/types.js";
import { biomeBoundaries, biomeLabelAnchors, biomeRegions, sampleBiomeField } from "./biome-contours.js";

const sites: BiomeSite[] = [
  { id: "a", biome: "cotidiano", x: -18, y: -8, radius: 20 },
  { id: "b", biome: "ciencia", x: 16, y: -12, radius: 20 },
  { id: "c", biome: "historia", x: -12, y: 14, radius: 20 },
  { id: "d", biome: "cultura-pop", x: 20, y: 12, radius: 20 },
];
const field = createBiomeField(biomeFieldSpecFromSeed("cruzaverso:2026-08-23"), sites);
const area = { minX: -20, minY: -14, maxX: 20, maxY: 14 };
const sample = sampleBiomeField(field, area, 1);

describe("amostragem do campo", () => {
  it("cobre a área pedida", () => {
    expect(sample.width).toBe(41);
    expect(sample.height).toBe(29);
    expect(sample.at(0, 0)).toBe(field.biomeAt(-20, -14));
  });
});

describe("fronteiras", () => {
  it("produz polilinhas com pelo menos dois pontos", () => {
    const lines = biomeBoundaries(sample);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.length).toBeGreaterThanOrEqual(2);
  });

  it("não produz escada: a maioria dos passos deixa de ser paralela aos eixos", () => {
    // A fronteira crua da grade dual é 100% paralela aos eixos. Depois do
    // Chaikin, a maioria dos passos precisa ser diagonal. Medido no agregado:
    // uma fronteira longa e genuinamente reta não deve reprovar o conjunto.
    const lines = biomeBoundaries(sample).filter((line) => line.length > 8);
    expect(lines.length).toBeGreaterThan(0);
    let steps = 0;
    let axisAligned = 0;
    for (const line of lines) {
      for (let index = 1; index < line.length; index += 1) {
        steps += 1;
        const previous = line[index - 1] as { x: number; y: number };
        const current = line[index] as { x: number; y: number };
        if (current.x === previous.x || current.y === previous.y) axisAligned += 1;
      }
    }
    expect(axisAligned / steps).toBeLessThan(0.5);
  });

  it("mantém as fronteiras dentro da área amostrada", () => {
    for (const line of biomeBoundaries(sample)) {
      for (const point of line) {
        expect(point.x).toBeGreaterThanOrEqual(area.minX - 1);
        expect(point.x).toBeLessThanOrEqual(area.maxX + 1);
        expect(point.y).toBeGreaterThanOrEqual(area.minY - 1);
        expect(point.y).toBeLessThanOrEqual(area.maxY + 1);
      }
    }
  });
});

describe("regiões e rótulos", () => {
  it("agrupa toda amostra em alguma região", () => {
    const total = biomeRegions(sample).reduce(
      (sum, region) => sum + region.runs.reduce((width, run) => width + run.width, 0),
      0,
    );
    expect(total).toBe(sample.width * sample.height);
  });

  it("mede a corrida em unidades de mundo, não em amostras", () => {
    // `width` acompanha `x` e `y`: quem desenha multiplica os três pelo mesmo
    // tamanho de célula. Com passo 2, cada amostra cobre 2 unidades de mundo,
    // então a área coberta dobra sem que o número de amostras mude.
    const coarse = sampleBiomeField(field, area, 2);
    const total = biomeRegions(coarse).reduce(
      (sum, region) => sum + region.runs.reduce((width, run) => width + run.width, 0),
      0,
    );
    expect(coarse.step).toBe(2);
    expect(total).toBe(coarse.width * coarse.height * coarse.step);
    for (const region of biomeRegions(coarse)) {
      for (const run of region.runs) {
        expect(run.width % coarse.step).toBe(0);
        expect(run.x + run.width).toBeLessThanOrEqual(coarse.minX + coarse.width * coarse.step);
      }
    }
  });

  it("comprime corridas horizontais em vez de emitir uma célula por amostra", () => {
    const runs = biomeRegions(sample).reduce((sum, region) => sum + region.runs.length, 0);
    expect(runs).toBeLessThan((sample.width * sample.height) / 3);
  });

  it("dá uma âncora por bioma presente, dentro da área", () => {
    const anchors = biomeLabelAnchors(sample);
    const present = new Set(biomeRegions(sample).map((region) => region.biome));
    expect(anchors.map((anchor) => anchor.biome).sort()).toEqual([...present].sort());
    for (const anchor of anchors) {
      expect(anchor.room).toBeGreaterThan(0);
      expect(anchor.x).toBeGreaterThanOrEqual(area.minX);
      expect(anchor.x).toBeLessThanOrEqual(area.maxX);
    }
  });

  it("ancora o rótulo dentro do próprio bioma", () => {
    for (const anchor of biomeLabelAnchors(sample)) {
      expect(field.biomeAt(anchor.x, anchor.y)).toBe(anchor.biome);
    }
  });

  it("dá âncora a região que só toca a borda da área amostrada", () => {
    // Uma região sem fronteira interna nenhuma — só recorte — continua
    // precisando de rótulo. A BFS trata a borda como origem justamente por isso.
    const uniform = createBiomeField(biomeFieldSpecFromSeed("cruzaverso:2026-08-23"), [sites[0] as BiomeSite]);
    const anchors = biomeLabelAnchors(sampleBiomeField(uniform, area, 1));
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0] as { biome: string; x: number; y: number; room: number };
    expect(anchor.biome).toBe("cotidiano");
    // Longe da borda: a folga é aproximadamente metade da menor dimensão.
    expect(anchor.room).toBeGreaterThan(10);
  });

  it("aceita área de um bioma só sem quebrar", () => {
    // Campo de site único: todo ponto cai no mesmo bioma, independente do warp.
    const uniform = createBiomeField(biomeFieldSpecFromSeed("cruzaverso:2026-08-23"), [sites[0] as BiomeSite]);
    const tiny = sampleBiomeField(uniform, area, 1);
    expect(biomeRegions(tiny)).toHaveLength(1);
    expect(biomeLabelAnchors(tiny)).toHaveLength(1);
    expect(biomeBoundaries(tiny)).toEqual([]);
  });
});
