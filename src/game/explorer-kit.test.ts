import { describe, expect, it } from "vitest";

import {
  chooseNeedle,
  DEFAULT_EXPLORER_KIT,
  equipCompass,
  needleBearing,
  parseExplorerKit,
  serializeExplorerKit,
  unlockCompass,
  unlocksCompass,
} from "./explorer-kit.js";

describe("kit do explorador", () => {
  it("volta ao padrão diante de conteúdo ausente, quebrado ou desconhecido", () => {
    expect(parseExplorerKit(null)).toEqual(DEFAULT_EXPLORER_KIT);
    expect(parseExplorerKit("{isto não é json")).toEqual(DEFAULT_EXPLORER_KIT);
    expect(parseExplorerKit(JSON.stringify({ compassUnlocked: true, needle: "agulha-de-ouro" })).needle).toBe(
      DEFAULT_EXPLORER_KIT.needle,
    );
  });

  it("recusa bússola equipada sem a conquista, mesmo se o salvo disser que sim", () => {
    const forjado = JSON.stringify({ compassUnlocked: false, compassEquipped: true, needle: "lanca-bicolor" });
    expect(parseExplorerKit(forjado).compassEquipped).toBe(false);
  });

  it("conquistar equipa, e conquistar de novo não mexe em nada", () => {
    const conquistado = unlockCompass(DEFAULT_EXPLORER_KIT);
    expect(conquistado).toMatchObject({ compassUnlocked: true, compassEquipped: true });
    const desequipado = equipCompass(conquistado, false);
    expect(unlockCompass(desequipado)).toBe(desequipado);
  });

  it("não equipa nem troca agulha antes da conquista", () => {
    expect(equipCompass(DEFAULT_EXPLORER_KIT, true)).toBe(DEFAULT_EXPLORER_KIT);
    expect(chooseNeedle(DEFAULT_EXPLORER_KIT, "pena-magnetica")).toBe(DEFAULT_EXPLORER_KIT);
  });

  it("sobrevive à ida e volta pelo armazenamento", () => {
    const kit = chooseNeedle(unlockCompass(DEFAULT_EXPLORER_KIT), "pena-magnetica");
    expect(parseExplorerKit(serializeExplorerKit(kit))).toEqual(kit);
  });

  it("a conquista é concluir uma expedição diária, e só ela", () => {
    expect(unlocksCompass("daily", "won")).toBe(true);
    expect(unlocksCompass("daily", "playing")).toBe(false);
    // O modo livre não termina: se contasse, a conquista seria automática.
    expect(unlocksCompass("free", "won")).toBe(false);
  });
});

describe("rumo da agulha", () => {
  it("repousa no norte sem alvo", () => {
    expect(needleBearing(null)).toBe(0);
    expect(needleBearing({ x: 0, y: 0 })).toBe(0);
  });

  it("mede o rumo com zero no norte da carta", () => {
    expect(needleBearing({ x: 0, y: -1 })).toBe(0);
    expect(needleBearing({ x: 1, y: 0 })).toBe(90);
    expect(needleBearing({ x: 0, y: 1 })).toBe(180);
    expect(needleBearing({ x: -1, y: 0 })).toBe(-90);
    expect(needleBearing({ x: -1, y: -1 })).toBe(-45);
  });
});
