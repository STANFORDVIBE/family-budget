import type { Page } from "@playwright/test";
import { expect, onboard, test } from "./app";

async function setup(page: Page) {
  await onboard(page);
  await page.getByRole("button", { name: "Добавить счёт" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Название").fill("Карта");
  await dialog.getByLabel("Начальный баланс").fill("100000");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();
}

async function expense(page: Page, amount: string, category: string) {
  await page.keyboard.press("Control+n");
  await page.getByRole("dialog").getByRole("radio", { name: "Расход" }).click();
  await page.getByLabel("Сумма").fill(amount);
  await page.getByRole("dialog").getByLabel("Категория", { exact: true }).click();
  await page.getByRole("option", { name: category }).click();
  await page.getByTestId("tx-save").click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("budget limits warn at 80% and flag overspending", async ({ app }) => {
  const page = app.page;
  await setup(page);
  await page.keyboard.press("Control+5");

  await page.getByRole("button", { name: "Задать" }).click();
  await page.getByLabel("Лимит", { exact: true }).fill("50000");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();

  await page.getByRole("button", { name: "Добавить лимит" }).click();
  await page.getByRole("dialog").getByLabel("Категория").click();
  await page.getByRole("option", { name: "Продукты" }).click();
  await page.getByLabel("Лимит", { exact: true }).fill("10000");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("limit-row")).toContainText("Продукты");

  await expense(page, "8000", "Продукты");
  await expect(page.getByTestId("limit-row")).toContainText("Использовано больше 80%");
  await expense(page, "2500", "Продукты");
  await expect(page.getByTestId("limit-row")).toContainText("Лимит превышен");
  await expect(page.getByTestId("limit-row")).toContainText("Перерасход 500,00");
  await page.screenshot({ path: "test-results/06-budgets.png" });

  // Drill-down from a limit opens the operations of that category
  await page.getByTestId("limit-row").getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Операции" }).click();
  await expect(page.getByTestId("tx-row")).toHaveCount(2);

  // Dashboard shows the remaining total budget: 50 000 − 10 500
  await page.keyboard.press("Control+1");
  await expect(page.getByText("39 500,00 ₽").first()).toBeVisible();
});

test("recurring payment creates a pending operation that is confirmed by hand", async ({ app }) => {
  const page = app.page;
  await setup(page);
  await page.keyboard.press("Control+6");
  await page.getByRole("button", { name: "Добавить платёж" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Название").fill("Интернет");
  await dialog.getByLabel("Сумма").fill("700");
  await dialog.getByLabel("Категория").click();
  await page.getByRole("option", { name: "Коммунальные услуги" }).click();
  // Starts today: due right away
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("recurring-row")).toContainText("Интернет");

  // Generation runs at start-up and on workspace switch: restart the app
  const restarted = await app.restart();
  await restarted.keyboard.press("Control+6");
  await expect(restarted.getByText("Ждут подтверждения", { exact: true })).toBeVisible();
  const pending = restarted.getByTestId("tx-row");
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText("ожидает");

  // A pending payment does not touch the balance until confirmed
  await restarted.keyboard.press("Control+3");
  await expect(restarted.getByTestId("account-card")).toContainText("100 000,00");
  await restarted.keyboard.press("Control+6");
  await pending.first().getByText("Коммунальные услуги").click();
  await restarted.getByRole("button", { name: "Провести платёж" }).click();
  await expect(restarted.getByText("Платёж проведён")).toBeVisible();
  await expect(restarted.getByText("Ждут подтверждения", { exact: true })).toBeHidden();
  await restarted.keyboard.press("Control+3");
  await expect(restarted.getByTestId("account-card")).toContainText("99 300,00");

  // Restarting again does not duplicate the same occurrence
  const again = await app.restart();
  await again.keyboard.press("Control+6");
  await expect(again.getByText("Ждут подтверждения", { exact: true })).toBeHidden();
});

test("goals: contribution by transfer, withdrawal, progress", async ({ app }) => {
  const page = app.page;
  await setup(page);
  // Storage account for the goal
  await page.keyboard.press("Control+3");
  await page.getByRole("button", { name: "Добавить счёт" }).first().click();
  await page.getByRole("dialog").getByLabel("Название").fill("Копилка");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("Control+7");
  await page.getByRole("button", { name: "Новая цель" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Название").fill("Отпуск");
  await dialog.getByLabel("Сколько нужно").fill("60000");
  await dialog.getByLabel("Счёт хранения").click();
  await page.getByRole("option", { name: /Копилка/ }).click();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();

  const goal = page.getByTestId("goal-card");
  await goal.getByRole("button", { name: "Пополнить" }).click();
  await page.getByRole("dialog").getByLabel("Сумма").fill("15000");
  await page.getByRole("dialog").getByLabel("С какого счёта").click();
  await page.getByRole("option", { name: /Карта/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Пополнить" }).click();
  await expect(goal).toContainText("25 %");
  await expect(goal).toContainText("15 000,00");

  await goal.getByRole("button", { name: "Снять" }).click();
  await page.getByRole("dialog").getByLabel("Сумма").fill("5000");
  await page.getByRole("dialog").getByRole("button", { name: "Снять" }).click();
  await expect(goal).toContainText("10 000,00");
  await page.screenshot({ path: "test-results/07-goals.png" });

  // The contribution was a real transfer between own accounts, not an expense
  await page.keyboard.press("Control+3");
  await expect(page.getByTestId("account-card").filter({ hasText: "Копилка" })).toContainText("15 000,00");
  await page.keyboard.press("Control+1");
  await expect(page.getByTestId("total-balance")).toContainText("100 000,00");
});
