import { describe, expect, it } from "vitest";

import {
  chooseNeedle,
  DEFAULT_EXPLORER_KIT,
  equipCompass,
  grantNeedle,
  needleBearing,
  needleEarnedBy,
  parseExplorerKit,
  serializeExplorerKit,
} from "./explorer-kit.js";

describe("kit do explorador", () => {
  it("nasce com o aro equipado e só a agulha inicial", () => {
    expect(DEFAULT_EXPLORER_KIT).toEqual({
      compassEquipped: true,
      needle: "seta-rumo",
      unlockedNeedles: ["seta-rumo"],
    });
  });

  it("volta ao padrão diante de conteúdo ausente, quebrado ou desconhecido", () => {
    expect(parseExplorerKit(null)).toEqual(DEFAULT_EXPLORER_KIT);
    expect(parseExplorerKit("{isto não é json")).toEqual(DEFAULT_EXPLORER_KIT);
    expect(parseExplorerKit(JSON.stringify({ needle: "agulha-de-ouro" })).needle).toBe(
      DEFAULT_EXPLORER_KIT.needle,
    );
  });

  it("recusa agulha não conquistada, mesmo se o salvo disser que sim", () => {
    const forjado = JSON.stringify({ needle: "pena-magnetica", unlockedNeedles: ["seta-rumo"] });
    expect(parseExplorerKit(forjado).needle).toBe("seta-rumo");
  });

  it("a agulha inicial nunca some do salvo, nem por lista vazia ou lixo", () => {
    expect(parseExplorerKit(JSON.stringify({ unlockedNeedles: [] })).unlockedNeedles).toEqual([
      "seta-rumo",
    ]);
    expect(
      parseExplorerKit(JSON.stringify({ unlockedNeedles: ["agulha-de-ouro", "pena-magnetica"] }))
        .unlockedNeedles,
    ).toEqual(["seta-rumo", "pena-magnetica"]);
  });

  it("o aro não depende de conquista: desequipar e reequipar é escolha do jogador", () => {
    expect(equipCompass(DEFAULT_EXPLORER_KIT, false).compassEquipped).toBe(false);
    expect(equipCompass(equipCompass(DEFAULT_EXPLORER_KIT, false), true).compassEquipped).toBe(true);
  });

  it("conceder uma agulha já a veste: o prêmio aparece sem passar por menu", () => {
    const premiado = grantNeedle(DEFAULT_EXPLORER_KIT, "lanca-bicolor");
    expect(premiado.unlockedNeedles).toEqual(["seta-rumo", "lanca-bicolor"]);
    expect(premiado.needle).toBe("lanca-bicolor");
    expect(premiado.compassEquipped).toBe(true);
  });

  it("conceder de novo não mexe em nada, nem devolve a agulha que o jogador trocou", () => {
    const premiado = grantNeedle(DEFAULT_EXPLORER_KIT, "lanca-bicolor");
    const trocado = chooseNeedle(premiado, "seta-rumo");
    expect(grantNeedle(trocado, "lanca-bicolor")).toBe(trocado);
  });

  it("só troca para agulha conquistada", () => {
    expect(chooseNeedle(DEFAULT_EXPLORER_KIT, "pena-magnetica")).toBe(DEFAULT_EXPLORER_KIT);
    const premiado = grantNeedle(DEFAULT_EXPLORER_KIT, "pena-magnetica");
    expect(chooseNeedle(premiado, "pena-magnetica").needle).toBe("pena-magnetica");
  });

  it("herda as duas agulhas de quem conquistou a bússola no modelo antigo", () => {
    // Na versão anterior a bússola chegava com as três agulhas juntas. Retirar
    // a que o veterano já usa seria uma regressão visível.
    const antigo = JSON.stringify({ compassUnlocked: true, compassEquipped: true, needle: "pena-magnetica" });
    const migrado = parseExplorerKit(antigo);
    expect(migrado.unlockedNeedles).toEqual(["seta-rumo", "lanca-bicolor", "pena-magnetica"]);
    expect(migrado.needle).toBe("pena-magnetica");
  });

  it("não concede nada a quem só tinha o modelo antigo bloqueado", () => {
    const antigo = JSON.stringify({ compassUnlocked: false, compassEquipped: false, needle: "seta-rumo" });
    expect(parseExplorerKit(antigo).unlockedNeedles).toEqual(["seta-rumo"]);
  });

  it("sobrevive à ida e volta pelo armazenamento", () => {
    const kit = grantNeedle(DEFAULT_EXPLORER_KIT, "pena-magnetica");
    expect(parseExplorerKit(serializeExplorerKit(kit))).toEqual(kit);
  });

  it("cada marco premia a sua agulha, e só ao concluir", () => {
    expect(needleEarnedBy("daily", "won")).toBe("lanca-bicolor");
    expect(needleEarnedBy("free", "won")).toBe("pena-magnetica");
    expect(needleEarnedBy("daily", "playing")).toBe(null);
    expect(needleEarnedBy("free", "playing")).toBe(null);
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
