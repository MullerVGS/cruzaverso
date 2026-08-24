import { describe, expect, it } from "vitest";

import { canAfford, creditsForCapture, creditsForWord, priceOf } from "./economy.js";

describe("economia", () => {
  it("paga um crédito por letra da palavra", () => {
    expect(creditsForWord({ gridAnswer: "ABACAXI" })).toBe(7);
  });

  it("paga metade das células capturadas, arredondando para cima", () => {
    expect(creditsForCapture(9)).toBe(5);
  });

  it("limita o bônus de captura ao teto", () => {
    expect(creditsForCapture(400)).toBe(30);
  });

  it("não paga captura vazia", () => {
    expect(creditsForCapture(0)).toBe(0);
  });

  it("expõe o preço de cada item", () => {
    expect(priceOf("reveal-letter")).toBe(10);
    expect(priceOf("objective-direction")).toBe(22);
  });

  it("a letra nunca se paga sozinha", () => {
    // A média do catálogo é 7,3 letras. Se o preço cair abaixo disso, comprar
    // letra vira máquina de crédito.
    expect(priceOf("reveal-letter")).toBeGreaterThan(8);
  });

  it("reconhece saldo insuficiente", () => {
    expect(canAfford(9, "reveal-letter")).toBe(false);
    expect(canAfford(10, "reveal-letter")).toBe(true);
  });
});
