import { expect, test } from "@playwright/test";

import { cellsForWord, coordinateKey, type DailyMap, type PlacedWord } from "../../src/generation/types.js";

function nextReachableWord(map: DailyMap, solved: Set<string>): PlacedWord | undefined {
  if (solved.size === 0) {
    return map.words.find((word) =>
      cellsForWord(word).some((cell) => coordinateKey(cell) === coordinateKey(map.spawn)),
    );
  }
  const solvedCells = new Set(
    map.words
      .filter((word) => solved.has(word.id))
      .flatMap((word) => cellsForWord(word).map(coordinateKey)),
  );
  return map.words.find(
    (word) =>
      !solved.has(word.id) && cellsForWord(word).some((cell) => solvedCells.has(coordinateKey(cell))),
  );
}

test("uma expedição pode sair da primeira pista e chegar à vitória", async ({ page, request }, testInfo) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cruzaverso" })).toBeVisible();
  await page.getByRole("button", { name: /desbravar|continuar/i }).click();
  await expect(page.getByText("DIÁRIO DE CAMPO")).toBeVisible();
  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("game-start.png"), fullPage: true });
  }

  const solved = new Set<string>();
  while (solved.size < map.words.length) {
    const word = nextReachableWord(map, solved);
    expect(word, "toda palavra deve chegar à fronteira resolvida").toBeDefined();
    await page.locator(`[data-word-id="${word!.id}"]`).click();
    const input = page.locator("#answer-input");
    await input.fill(word!.gridAnswer);
    await page.getByRole("button", { name: "Conferir" }).click();
    await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();
    solved.add(word!.id);
  }

  for (const key of map.objects.filter((object) => object.type === "key").slice(0, 2)) {
    await page.locator(`[data-cell-key="${coordinateKey(key.position)}"]`).click();
  }
  const exit = map.objects.find((object) => object.type === "exit");
  expect(exit).toBeDefined();
  await page.locator(`[data-cell-key="${coordinateKey(exit!.position)}"]`).click();

  await expect(page.getByRole("heading", { name: "O mapa se abriu." })).toBeVisible();
  await expect(page.getByText(/tempo ativo/)).toBeVisible();
  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("victory.png"), fullPage: true });
  }
});
