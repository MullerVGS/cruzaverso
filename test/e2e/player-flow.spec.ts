import { expect, test, type Page } from "@playwright/test";

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

async function wallet(page: Page): Promise<number> {
  const text = (await page.locator(".wallet").textContent()) ?? "";
  // O saldo previsto aparece como "⬡ 47 → 37": o primeiro número é o real.
  return Number(text.replace(/[^\d→]/g, " ").trim().split(/\s|→/)[0]);
}

test("uma expedição pode sair da primeira pista e chegar à vitória", async ({ page, request }, testInfo) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cruzaverso" })).toBeVisible();
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();
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

  // O mapa diário só tem chave e saída: item no chão saiu do jogo, e moeda é do livre.
  expect(map.objects.some((object) => object.type === "coin")).toBe(false);
  expect(map.objective).toEqual({ kind: "keys-and-exit", keysRequired: 2, keysAvailable: 3 });

  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("game-start.png"), fullPage: true });
  }

  const solved = new Set<string>();
  while (solved.size < map.words.length) {
    const word = nextReachableWord(map, solved);
    expect(word, "toda palavra deve chegar à fronteira resolvida").toBeDefined();
    await page.locator(`[data-word-id="${word!.id}"]`).click();
    await page.locator("#answer-input").fill(word!.gridAnswer);
    await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();
    solved.add(word!.id);
  }

  // Resolver a rede inteira tem que ter pago crédito por letra e por captura.
  const totalLetras = map.words.reduce((sum, word) => sum + word.gridAnswer.length, 0);
  expect(await wallet(page)).toBeGreaterThan(totalLetras);

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

test("comprar um item cobra só quando ele aplica, e cancelar devolve tudo", async ({ page, request }, testInfo) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };
  const primeira = map.words.find((word) =>
    cellsForWord(word).some((cell) => coordinateKey(cell) === coordinateKey(map.spawn)),
  );
  expect(primeira).toBeDefined();

  await page.goto("/");
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();

  const saldoInicial = await wallet(page);
  expect(saldoInicial).toBe(15);

  const letra = page.locator('.shop-slot button[data-item="reveal-letter"]');
  const aviso = page.locator(".armed-banner");

  // Armar: o aviso aparece, o saldo previsto mostra o desconto, mas nada saiu.
  await letra.click();
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Letra encontrada");
  await expect(page.locator(".wallet i")).toContainText("5");
  await expect(letra).toHaveAttribute("aria-pressed", "true");
  expect(await wallet(page)).toBe(saldoInicial);
  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("item-armado.png"), fullPage: true });
  }

  // Cancelar pelo Esc: o reembolso é garantido porque nada foi cobrado.
  await page.keyboard.press("Escape");
  await expect(aviso).toHaveCount(0);
  expect(await wallet(page)).toBe(saldoInicial);

  // Cancelar clicando de novo no mesmo item.
  await letra.click();
  await expect(aviso).toBeVisible();
  await letra.click();
  await expect(aviso).toHaveCount(0);
  expect(await wallet(page)).toBe(saldoInicial);

  // Aplicar: agora sim o crédito sai, e a letra fica com cor própria.
  const alvo = cellsForWord(primeira!)[0]!;
  await letra.click();
  await page.locator(`[data-cell-key="${coordinateKey(alvo)}"]`).click();
  await expect(aviso).toHaveCount(0);
  expect(await wallet(page)).toBe(saldoInicial - 10);
  const letraComprada = page.locator(`[data-cell-key="${coordinateKey(alvo)}"] text.is-hinted`);
  await expect(letraComprada).toBeAttached();
  await expect(letraComprada).toHaveText(alvo.letter);
  await expect(page.locator(".answer-slot.is-hinted")).toHaveCount(1);

  // Outra pista abre a segunda sem apagar a original.
  await expect(page.locator(".clue-line")).toHaveCount(1);
  await page.locator('.shop-slot button[data-item="simplify-clue"]').click();
  await page.locator(`[data-cell-key="${coordinateKey(cellsForWord(primeira!)[1]!)}"]`).click();
  await expect(page.locator(".clue-line")).toHaveCount(2);
  await expect(page.locator(".clue-line.is-extra")).toContainText(primeira!.clues.simple);
  await expect(page.locator(".clue-line").first()).toContainText(primeira!.clues.normal);
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
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();

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

  // O bug que motivou tudo: numa palavra que cruza a resolvida, o jogador digita
  // a resposta INTEIRA. A casa já em tinta tem que engolir a tecla, não deslocar
  // todas as letras seguintes.
  const cruzada = map.words.find(
    (word) =>
      word.id !== initialWord.id &&
      cellsForWord(word).some((cell) =>
        cellsForWord(initialWord).some((solvedCell) => coordinateKey(solvedCell) === coordinateKey(cell)),
      ),
  );
  expect(cruzada, "o mapa precisa ter um cruzamento com a primeira palavra").toBeDefined();
  await page.locator(`[data-word-id="${cruzada!.id}"]`).click();
  await expect(page.locator(".answer-slot.in-ink")).toHaveCount(1);
  await page.keyboard.type(cruzada!.gridAnswer);
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

test("a expedição livre é sandbox com moedas e o arquivo lista o que já saiu", async ({ page, request }, testInfo) => {
  const seed = "nebulosa-e2e";
  const freeResponse = await request.get(`/api/world?seed=${seed}`);
  expect(freeResponse.status()).toBe(200);
  const { map } = (await freeResponse.json()) as { map: DailyMap };

  expect(map.mode).toBe("free");
  expect(map.objective).toEqual({ kind: "sandbox" });
  expect(map.objects.every((object) => object.type === "coin")).toBe(true);
  expect(map.id.startsWith("livre-m2-")).toBe(true);

  await page.goto(`/?seed=${seed}`);
  await expect(page.getByText("EXPEDIÇÃO LIVRE")).toBeVisible();
  await page.getByRole("button", { name: /explorar|continuar|rever/i }).click();

  // Sem chave e sem saída: a tarja de objetivo do diário não existe aqui.
  await expect(page.getByText("Encontre 2 chaves")).toHaveCount(0);
  await expect(page.locator(".wallet")).toBeVisible();
  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("expedicao-livre.png"), fullPage: true });
  }

  await page.goto("/");
  const arquivo = page.locator(".archive li");
  await expect(arquivo.first()).toBeVisible();
  await expect(arquivo.first().locator(".archive-status")).toContainText(/concluída|andamento|nova/);
});
