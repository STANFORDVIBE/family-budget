import { expect, onboard, test } from "./app";

test("first run, account, expense, persistence", async ({ app }) => {
  let page = app.page;
  await expect(page.getByText("Добро пожаловать в Family Budget")).toBeVisible();
  await onboard(page);
  await expect(page.getByText("Начните с первого счёта")).toBeVisible();
  await page.screenshot({ path: "test-results/01-empty-dashboard.png" });

  // Account
  await page.getByRole("button", { name: "Добавить счёт" }).click();
  await page.getByLabel("Название").fill("Карта");
  await page.getByLabel("Начальный баланс").fill("10 000");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("account-card")).toContainText("10 000,00");

  // Expense via Ctrl+N
  await page.keyboard.press("Control+n");
  await page.getByLabel("Сумма").fill("1234,5");
  await page.getByLabel("Категория").click();
  await page.getByRole("option", { name: "Продукты" }).click();
  await page.getByTestId("tx-save").click();
  await expect(page.getByText("Операция добавлена")).toBeVisible();
  await expect(page.getByTestId("account-card")).toContainText("8 765,50");

  await page.keyboard.press("Control+1");
  await expect(page.getByTestId("total-balance")).toContainText("8 765,50");
  await page.screenshot({ path: "test-results/02-dashboard.png" });

  // Data survives a restart
  page = await app.restart();
  await expect(page.getByTestId("total-balance")).toContainText("8 765,50");
});
