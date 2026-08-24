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

  // O fundo precisa ser o campo de biomas desenhado, não as barras por palavra.
  await expect(page.locator(".biome-atlas")).toBeVisible();
  await expect(page.locator(".biome-coast path").first()).toBeAttached();
  await expect(page.locator(".biome-washes")).toHaveCount(0);
  await expect(page.locator(".fog-layer .fog-chart")).toBeAttached();
  // A grade é traço à mão: nenhuma célula sobrou como retângulo.
  await expect(page.locator(".crossword-cell rect")).toHaveCount(0);
  await expect(page.locator(".crossword-cell path").first()).toBeAttached();
  // O cartucho anuncia só os biomas presentes no recorte do dia.
  const biomasNoMapa = new Set(map.words.map((word) => word.biome));
  await expect(page.locator(".map-cartouche li")).toHaveCount(biomasNoMapa.size);
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
    await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();
    solved.add(word!.id);
  }

  const powerup = map.objects.find((object) => object.type === "powerup");
  expect(powerup).toBeDefined();
  const powerupMarker = page.locator(`[data-powerup-id="${powerup!.id}"]`);
  await expect(powerupMarker).toBeVisible();
  // Com a palavra resolvida a célula tem letra: o powerup vira selo de canto,
  // desenhado acima das letras, e a letra continua legível.
  await expect(powerupMarker).toHaveClass(/is-mark/);
  await expect(powerupMarker.locator(".powerup-badge")).toBeVisible();
  await powerupMarker.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/[A-Za-zÀ-ÿ]{4,}/);
  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("powerup-tooltip.png"), fullPage: true });
  }
  await powerupMarker.click();
  await expect(page.locator("[data-player-key]")).toHaveAttribute(
    "data-player-key",
    coordinateKey(powerup!.position),
  );

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

test("o teclado escreve, troca de palavra e move sem disputar letras com a câmera", async ({ page, request }) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };
  const initialWords = map.words.filter((word) =>
    cellsForWord(word).some((cell) => coordinateKey(cell) === coordinateKey(map.spawn)),
  );
  expect(initialWords.length).toBeGreaterThan(1);
  const initialWord = initialWords[0]!;

  await page.goto("/");
  await page.getByRole("button", { name: /desbravar|continuar/i }).click();

  const answerInput = page.locator("#answer-input");
  await expect(answerInput).toHaveAttribute("data-selected-word-id", initialWord.id);
  await expect(page.locator(`[data-word-frame="${initialWord.id}"]`)).toHaveAttribute(
    "data-word-length",
    String(initialWord.gridAnswer.length),
  );
  await expect(page.locator(".answer-pattern .answer-slot")).toHaveCount(initialWord.gridAnswer.length);

  await page.keyboard.press("Tab");
  await expect(answerInput).not.toHaveAttribute("data-selected-word-id", initialWord.id);
  await page.keyboard.press("Shift+Tab");
  await expect(answerInput).toHaveAttribute("data-selected-word-id", initialWord.id);

  await page.keyboard.press("a");
  await expect(page.locator(".answer-pattern .answer-slot").first()).toHaveText("A");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".answer-pattern .answer-slot").first()).toBeEmpty();

  await page.keyboard.type(initialWord.gridAnswer);
  await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();

  const wordCells = cellsForWord(initialWord);
  const spawnIndex = wordCells.findIndex(
    (cell) => coordinateKey(cell) === coordinateKey(map.spawn),
  );
  const destination = wordCells[spawnIndex + 1] ?? wordCells[spawnIndex - 1];
  expect(destination).toBeDefined();
  const movementKey = destination!.x > map.spawn.x
    ? "ArrowRight"
    : destination!.x < map.spawn.x
      ? "ArrowLeft"
      : destination!.y > map.spawn.y
        ? "ArrowDown"
        : "ArrowUp";
  await page.keyboard.press(movementKey);
  await expect(page.locator("[data-player-key]")).toHaveAttribute(
    "data-player-key",
    coordinateKey(destination!),
  );

  await page.locator(`[data-cell-key="${coordinateKey(map.spawn)}"]`).click();
  await expect(page.locator("[data-player-key]")).toHaveAttribute(
    "data-player-key",
    coordinateKey(map.spawn),
  );

  const atlas = page.getByRole("img", { name: "Mapa de palavras cruzadas do dia" });
  const viewBoxBeforePan = await atlas.getAttribute("viewBox");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(atlas).not.toHaveAttribute("viewBox", viewBoxBeforePan!);
  await expect(page.locator("[data-player-key]")).toHaveAttribute(
    "data-player-key",
    coordinateKey(map.spawn),
  );
});
