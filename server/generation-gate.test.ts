import { describe, expect, it } from "vitest";

import { GenerationGate } from "./generation-gate.js";

describe("portão de geração", () => {
  it("libera até o limite por IP e barra o excedente", () => {
    const gate = new GenerationGate({ perIpPerMinute: 2, globalPerHour: 100, now: () => 0 });
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
    expect(gate.tryAcquire("1.1.1.1")).toBe("ip-limited");
  });

  it("libera de novo depois de um minuto", () => {
    let now = 0;
    const gate = new GenerationGate({ perIpPerMinute: 1, globalPerHour: 100, now: () => now });
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
    now = 61_000;
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
  });

  it("não deixa um IP consumir a cota de outro", () => {
    const gate = new GenerationGate({ perIpPerMinute: 1, globalPerHour: 100, now: () => 0 });
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
    expect(gate.tryAcquire("2.2.2.2")).toBe("ok");
  });

  it("barra no teto global mesmo com IPs diferentes", () => {
    const gate = new GenerationGate({ perIpPerMinute: 5, globalPerHour: 2, now: () => 0 });
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
    expect(gate.tryAcquire("2.2.2.2")).toBe("ok");
    expect(gate.tryAcquire("3.3.3.3")).toBe("global-limited");
  });

  it("uma tentativa barrada não consome cota", () => {
    let now = 0;
    const gate = new GenerationGate({ perIpPerMinute: 1, globalPerHour: 100, now: () => now });
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
    expect(gate.tryAcquire("1.1.1.1")).toBe("ip-limited");
    expect(gate.tryAcquire("1.1.1.1")).toBe("ip-limited");
    now = 61_000;
    expect(gate.tryAcquire("1.1.1.1")).toBe("ok");
  });

  it("serializa as gerações concorrentes", async () => {
    const gate = new GenerationGate({ perIpPerMinute: 9, globalPerHour: 9 });
    const order: string[] = [];
    const first = gate.serialize(async () => {
      order.push("a-início");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-fim");
      return "a";
    });
    const second = gate.serialize(async () => {
      order.push("b-início");
      return "b";
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["a-início", "a-fim", "b-início"]);
  });

  it("uma geração que falha não trava a fila", async () => {
    const gate = new GenerationGate({ perIpPerMinute: 9, globalPerHour: 9 });
    await expect(
      gate.serialize(async () => {
        throw new Error("estourou");
      }),
    ).rejects.toThrow("estourou");
    await expect(gate.serialize(async () => "ok")).resolves.toBe("ok");
  });
});
