import { describe, expect, it } from "vitest";

import { hashString, seedFingerprint } from "./random.js";

describe("identidade determinística", () => {
  it("usa 128 bits e separa a colisão real encontrada nos ids de mapas livres", () => {
    const firstInput = "livre-g2-f6e28d2c:medium:free:3.0.0:2.0.0";
    const secondInput = "livre-g2-2ba09813:medium:free:3.0.0:2.0.0";
    const first = seedFingerprint(firstInput);
    const second = seedFingerprint(secondInput);

    expect(hashString(firstInput)).toBe(hashString(secondInput));
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });
});
