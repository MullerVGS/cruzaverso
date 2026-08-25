import { expect, test, type Page } from "@playwright/test";

/** Abre o instrumento pelo botão, seja na tela inicial ou dentro da run. */
async function abrirInstrumento(page: Page) {
  await page.getByRole("button", { name: /instrumento do explorador/i }).click();
  await expect(page.locator(".kit-panel")).toBeVisible();
}

async function entrarNaRun(page: Page) {
  await page.getByRole("button", { name: /desbravar|continuar|rever/i }).click();
  await expect(page.locator(".crossword-cell").first()).toBeVisible();
}

test("a tela inicial abre o instrumento com a agulha inicial já em mãos", async ({ page }) => {
  await page.goto("/");
  await abrirInstrumento(page);

  // O aro nunca é conquista: aparece no painel desde a primeira visita.
  await expect(page.locator(".kit-panel .kit-housing")).toBeVisible();

  await expect(page.locator(".kit-panel [data-needle-id]")).toHaveCount(3);
  await expect(page.locator('.kit-panel [data-needle-id="seta-rumo"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('.kit-panel [data-needle-id="lanca-bicolor"]')).toHaveClass(/is-locked/);
  await expect(page.locator('.kit-panel [data-needle-id="pena-magnetica"]')).toHaveClass(/is-locked/);
});

test("a agulha bloqueada diz o marco que a solta e recusa o clique", async ({ page }) => {
  await page.goto("/");
  await abrirInstrumento(page);

  const bloqueada = page.locator('.kit-panel [data-needle-id="lanca-bicolor"]');
  await expect(bloqueada).toHaveAttribute("title", /expedição diária/i);

  await bloqueada.click({ force: true });
  await expect(page.locator('.kit-panel [data-needle-id="seta-rumo"]')).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(bloqueada).toHaveAttribute("aria-checked", "false");
});

test("o instrumento também abre dentro da run, e desequipar devolve o marcador simples", async ({
  page,
}) => {
  await page.goto("/");
  await entrarNaRun(page);

  // Equipado por padrão: quem nunca jogou já anda com a bússola.
  await expect(page.locator(".explorer-compass")).toBeAttached();

  await abrirInstrumento(page);
  await page.getByRole("checkbox", { name: /equipar a bússola/i }).uncheck();
  await expect(page.locator(".explorer-compass")).toHaveCount(0);
  await expect(page.locator(".explorer-marker")).toBeAttached();

  await page.getByRole("checkbox", { name: /equipar a bússola/i }).check();
  await expect(page.locator(".explorer-compass")).toBeAttached();
});

test("a escolha do instrumento atravessa a recarga da página", async ({ page }) => {
  await page.goto("/");
  await abrirInstrumento(page);
  await page.getByRole("checkbox", { name: /equipar a bússola/i }).uncheck();

  await page.reload();
  await abrirInstrumento(page);
  await expect(page.getByRole("checkbox", { name: /equipar a bússola/i })).not.toBeChecked();
});

test("quem conquistou a bússola no modelo antigo mantém as três agulhas", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "cruzaverso:kit",
      JSON.stringify({ compassUnlocked: true, compassEquipped: true, needle: "pena-magnetica" }),
    ),
  );
  await page.reload();
  await abrirInstrumento(page);

  await expect(page.locator(".kit-panel [data-needle-id].is-locked")).toHaveCount(0);
  await expect(page.locator('.kit-panel [data-needle-id="pena-magnetica"]')).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
