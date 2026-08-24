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
  await expect(page.locator(".clue-index")).toBeVisible();
  await expect(page.locator(".run-tally")).toContainText(`0/${map.words.length}`);

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

  // Com o mapa inteiro resolvido não sobra rota bloqueada: mirar a Luneta em
  // qualquer lugar tem que recusar sem cobrar, e a mira continua de pé.
  const saldoAntesDaLuneta = await wallet(page);
  await page.locator('.shop-slot button[data-item="unlock-route"]').click();
  await expect(page.locator(".armed-banner")).toBeVisible();
  await page.locator(`[data-cell-key="${coordinateKey(map.spawn)}"]`).click();
  await expect(page.getByText("Nenhuma rota bloqueada aí.")).toBeVisible();
  await expect(page.locator(".armed-banner")).toBeVisible();
  expect(await wallet(page)).toBe(saldoAntesDaLuneta);
  await page.keyboard.press("Escape");

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
  expect(saldoInicial).toBe(25);

  const letra = page.locator('.shop-slot button[data-item="reveal-letter"]');
  const aviso = page.locator(".armed-banner");

  // Armar: o aviso aparece, o saldo previsto mostra o desconto, mas nada saiu.
  await letra.click();
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Letra encontrada");
  await expect(page.locator(".wallet i")).toContainText("15");
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
  // O alvo é de propósito a casa onde o explorador está: o marcador dele já
  // engoliu o clique da própria casa, e o jogador clicava no alvo destacado sem
  // nada acontecer.
  const alvo = cellsForWord(primeira!).find(
    (cell) => coordinateKey(cell) === coordinateKey(map.spawn),
  )!;
  await letra.click();
  await page.locator(`[data-cell-key="${coordinateKey(alvo)}"]`).click();
  await expect(aviso).toHaveCount(0);
  expect(await wallet(page)).toBe(saldoInicial - 10);
  const letraComprada = page.locator(`text[data-letter-key="${coordinateKey(alvo)}"]`);
  await expect(letraComprada).toBeAttached();
  await expect(letraComprada).toHaveClass(/is-hinted/);
  await expect(letraComprada).toHaveText(alvo.letter);
  await expect(page.locator(".answer-slot.is-hinted")).toHaveCount(1);

  // O estipêndio paga duas ajudas no começo: depois da letra ainda sobra para a
  // pista, mas os itens de exploração ficam fora de alcance, e isso é visível.
  await expect(page.locator('.shop-slot button[data-item="simplify-clue"]')).toBeEnabled();
  await expect(page.locator('.shop-slot button[data-item="unlock-route"]')).toBeDisabled();
  await expect(page.locator('.shop-slot button[data-item="unlock-route"]')).toHaveClass(/is-broke/);
});

test("a pista extra entra sem apagar a original", async ({ page, request }) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };
  const primeira = map.words.find((word) =>
    cellsForWord(word).some((cell) => coordinateKey(cell) === coordinateKey(map.spawn)),
  );
  expect(primeira).toBeDefined();

  await page.goto("/");
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();
  await expect(page.locator(`[data-word-id="${primeira!.id}"]`)).toBeVisible();
  await page.locator(`[data-word-id="${primeira!.id}"]`).click();

  await expect(page.locator(".clue-line")).toHaveCount(1);
  await page.locator('.shop-slot button[data-item="simplify-clue"]').click();
  await page.locator(`[data-cell-key="${coordinateKey(cellsForWord(primeira!)[0]!)}"]`).click();

  await expect(page.locator(".clue-line")).toHaveCount(2);
  await expect(page.locator(".clue-line").first()).toContainText(primeira!.clues.normal);
  await expect(page.locator(".clue-line.is-extra")).toContainText(primeira!.clues.simple);
  expect(await wallet(page)).toBe(25 - 14);
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
  await expect(page.locator(".expedition-ticket")).toContainText("EXPEDIÇÃO LIVRE");
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

test("o número da lista é o mesmo pintado na casa inicial do mapa", async ({ page, request }, testInfo) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };

  await page.goto("/");
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();

  const colunas = page.locator(".clue-column");
  await expect(colunas).toHaveCount(2);
  await expect(colunas.nth(0)).toContainText("VERTICAIS");
  await expect(colunas.nth(1)).toContainText("HORIZONTAIS");

  // Cada coluna só pode conter palavras da sua orientação.
  for (const [indice, orientacao] of [[0, "vertical"], [1, "horizontal"]] as const) {
    const ids = await colunas.nth(indice).locator("button").evaluateAll(
      (botoes) => botoes.map((botao) => (botao as HTMLElement).dataset.wordId as string),
    );
    for (const id of ids) {
      expect(map.words.find((word) => word.id === id)?.orientation).toBe(orientacao);
    }
  }

  // É a correspondência com o mapa que faz o recurso existir: o número da lista
  // tem que ser o mesmo desenhado na casa onde a palavra começa.
  const entradas = page.locator(".clue-column button");
  const total = await entradas.count();
  expect(total).toBeGreaterThan(1);
  for (let indice = 0; indice < total; indice += 1) {
    const botao = entradas.nth(indice);
    const numero = await botao.getAttribute("data-word-number");
    const wordId = await botao.getAttribute("data-word-id");
    const palavra = map.words.find((word) => word.id === wordId);
    expect(palavra).toBeDefined();
    await expect(
      page.locator(`text[data-number-key="${coordinateKey(palavra!.start)}"]`),
    ).toHaveText(numero as string);
  }

  // O número segue a rota: forte na que dá para abrir, apagado na que ainda
  // não. Toda entrada da lista é uma rota liberada, então nenhuma pode estar
  // apagada — e o mapa precisa ter pelo menos uma apagada para haver hierarquia.
  for (let indice = 0; indice < total; indice += 1) {
    const wordId = (await entradas.nth(indice).getAttribute("data-word-id")) as string;
    const casa = coordinateKey(map.words.find((word) => word.id === wordId)!.start);
    await expect(page.locator(`text[data-number-key="${casa}"]`)).not.toHaveClass(/is-locked/);
  }
  expect(await page.locator("text.is-locked").count()).toBeGreaterThan(0);

  // O número segue a rota: forte na que dá para abrir, apagado na que ainda não.
  // Toda entrada da lista é rota liberada, então nenhuma pode estar apagada — e
  // o mapa precisa ter ao menos uma apagada para existir hierarquia.
  for (let indice = 0; indice < total; indice += 1) {
    const wordId = (await entradas.nth(indice).getAttribute("data-word-id")) as string;
    const casa = coordinateKey(map.words.find((word) => word.id === wordId)!.start);
    await expect(page.locator(`text[data-number-key="${casa}"]`)).not.toHaveClass(/is-locked/);
  }
  expect(await page.locator("text.is-locked").count()).toBeGreaterThan(0);

  // Uma vertical e uma horizontal que partem da mesma casa dividem o número.
  const porCasa = new Map<string, Set<string>>();
  for (let indice = 0; indice < total; indice += 1) {
    const botao = entradas.nth(indice);
    const wordId = (await botao.getAttribute("data-word-id")) as string;
    const numero = (await botao.getAttribute("data-word-number")) as string;
    const casa = coordinateKey(map.words.find((word) => word.id === wordId)!.start);
    porCasa.set(casa, (porCasa.get(casa) ?? new Set()).add(numero));
  }
  for (const numeros of porCasa.values()) expect(numeros.size).toBe(1);

  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("indice-de-rotas.png"), fullPage: true });
  }
});

test("a luneta libera uma rota avistada e ela passa a aceitar letras", async ({ page, request }, testInfo) => {
  const dailyResponse = await request.get("/api/daily");
  const { map } = (await dailyResponse.json()) as { map: DailyMap };
  const primeira = map.words.find((word) =>
    cellsForWord(word).some((cell) => coordinateKey(cell) === coordinateKey(map.spawn)),
  )!;

  await page.goto("/");
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();

  // Resolver a primeira palavra abre névoa suficiente para avistar rotas que
  // ainda não tocam a trilha — o alvo do item.
  await page.locator(`[data-word-id="${primeira.id}"]`).click();
  await page.locator("#answer-input").fill(primeira.gridAnswer);
  await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();

  // Junta crédito até poder pagar a Luneta.
  const solved = new Set([primeira.id]);
  while ((await wallet(page)) < 20) {
    const proxima = map.words.find(
      (word) =>
        !solved.has(word.id) &&
        cellsForWord(word).some((cell) =>
          map.words
            .filter((outra) => solved.has(outra.id))
            .flatMap((outra) => cellsForWord(outra).map(coordinateKey))
            .includes(coordinateKey(cell)),
        ),
    );
    expect(proxima).toBeDefined();
    await page.locator(`[data-word-id="${proxima!.id}"]`).click();
    await page.locator("#answer-input").fill(proxima!.gridAnswer);
    await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();
    solved.add(proxima!.id);
  }

  const bloqueadaNaLista = await page.locator(".clue-column button").count();
  const saldo = await wallet(page);

  await page.locator('.shop-slot button[data-item="unlock-route"]').click();
  await expect(page.locator(".armed-banner")).toContainText("rota avistada");
  const alvo = page.locator(".crossword-cell.is-target").first();
  await expect(alvo).toBeVisible();
  const chaveAlvo = await alvo.getAttribute("data-cell-key");
  await alvo.click();

  await expect(page.locator(".armed-banner")).toHaveCount(0);
  expect(await wallet(page)).toBe(saldo - 20);
  // A rota liberada entra no índice lateral, que só lista o que dá para resolver.
  expect(await page.locator(".clue-column button").count()).toBeGreaterThan(bloqueadaNaLista);

  // E ela aceita letra de verdade: escolhe a palavra liberada e resolve.
  const liberada = map.words.find(
    (word) =>
      !solved.has(word.id) &&
      cellsForWord(word).some((cell) => coordinateKey(cell) === chaveAlvo),
  )!;
  await page.locator(`[data-word-id="${liberada.id}"]`).click();
  await page.locator("#answer-input").fill(liberada.gridAnswer);
  await expect(page.getByText("O caminho ganhou tinta.")).toBeVisible();

  if (process.env.CAPTURE_UI === "true") {
    await page.screenshot({ path: testInfo.outputPath("luneta-libera-rota.png"), fullPage: true });
  }
});
