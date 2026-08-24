import { describe, expect, it } from "vitest";

import { sketchBlob, sketchCircle, sketchPolyline, sketchRect } from "./sketch.js";

function numbersIn(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

describe("traço à mão", () => {
  it("é determinístico para a mesma seed", () => {
    expect(sketchRect(0, 0, 34, 34, "cell:3,7")).toBe(sketchRect(0, 0, 34, 34, "cell:3,7"));
    expect(sketchPolyline([{ x: 0, y: 0 }, { x: 40, y: 0 }], "b")).toBe(
      sketchPolyline([{ x: 0, y: 0 }, { x: 40, y: 0 }], "b"),
    );
  });

  it("dá traços diferentes para seeds diferentes", () => {
    expect(sketchRect(0, 0, 34, 34, "cell:3,7")).not.toBe(sketchRect(0, 0, 34, 34, "cell:4,7"));
  });

  it("desvia da reta: uma horizontal ganha variação em y", () => {
    const path = sketchPolyline(
      [{ x: 0, y: 50 }, { x: 200, y: 50 }],
      "linha",
      { passes: 1, step: 20 },
    );
    const ys = numbersIn(path).filter((_, index) => index % 2 === 1);
    expect(new Set(ys).size).toBeGreaterThan(2);
    for (const y of ys) expect(Math.abs(y - 50)).toBeLessThan(6);
  });

  it("mantém os extremos da polilinha presos", () => {
    const path = sketchPolyline([{ x: 10, y: 10 }, { x: 90, y: 10 }], "presa", { passes: 1, step: 20 });
    const values = numbersIn(path);
    expect(values[0]).toBeCloseTo(10, 5);
    expect(values[1]).toBeCloseTo(10, 5);
    expect(values.at(-2)).toBeCloseTo(90, 5);
    expect(values.at(-1)).toBeCloseTo(10, 5);
  });

  it("desenha duas passadas por padrão", () => {
    const path = sketchRect(0, 0, 30, 30, "duas");
    expect([...path.matchAll(/M/g)]).toHaveLength(2);
  });

  it("fecha o retângulo e o círculo", () => {
    expect(sketchRect(0, 0, 30, 30, "fecha")).toContain("Z");
    expect(sketchCircle(50, 50, 20, "fecha")).toContain("Z");
  });

  it("gera blob fechado dentro do raio pedido", () => {
    const path = sketchBlob(0, 0, 100, "blob");
    expect(path).toContain("Z");
    const values = numbersIn(path);
    for (let index = 0; index + 1 < values.length; index += 2) {
      const distance = Math.hypot(values[index]!, values[index + 1]!);
      expect(distance).toBeGreaterThan(60);
      expect(distance).toBeLessThan(140);
    }
  });

  it("não usa Math.random", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("./sketch.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toContain("Math.random");
  });
});
