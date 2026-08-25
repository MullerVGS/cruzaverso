import { expect, test } from "@playwright/test";

import type { DailyMap } from "../../src/generation/types.js";

const SEED = "vereda-quieta-42";

test("a expedição livre anuncia as moedas como o fim, não como enfeite", async ({
  page,
  request,
}) => {
  const response = await request.get(`/api/world?seed=${SEED}`);
  const { map } = (await response.json()) as { map: DailyMap };
  const moedas = map.objects.filter((object) => object.type === "coin").length;
  expect(moedas).toBeGreaterThan(0);

  await page.goto(`/?seed=${SEED}`);

  // O bilhete dizia "sem fim" enquanto o modo era sandbox. Agora há linha de
  // chegada, e ela precisa estar dita antes de o jogador entrar.
  const bilhete = page.locator(".expedition-ticket");
  await expect(bilhete).toContainText(String(moedas));
  await expect(bilhete).not.toContainText(/sem fim/i);
  await expect(page.locator(".free-run small")).not.toContainText(/sem fim/i);

  await page.getByRole("button", { name: /explorar|continuar|rever/i }).click();
  await expect(page.locator(".objective-strip.is-sandbox")).toContainText(`0/${moedas}`);
});
