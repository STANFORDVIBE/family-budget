import { expect, onboard, test } from "./app";

test("personal and family budgets are isolated; members tag operations", async ({ app }) => {
  const page = app.page;
  await onboard(page, { family: true });

  // Onboarding with the family switch creates both; the personal one is active
  await expect(page.getByTestId("workspace-switcher")).toContainText("Личный бюджет");
  await expect(page.getByRole("button", { name: "Участники семьи" })).toHaveCount(0);

  // Personal account
  await page.getByRole("button", { name: "Добавить счёт" }).click();
  await page.getByRole("dialog").getByLabel("Название").fill("Моя карта");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();

  // Switch to the family budget: no personal data there
  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: "Семейный бюджет" }).click();
  await expect(page.getByTestId("workspace-switcher")).toContainText("Семейный");
  await expect(page.getByText("Счетов пока нет")).toBeVisible();

  // Members
  await page.getByRole("button", { name: "Участники семьи" }).click();
  await expect(page.getByText("это вы")).toBeVisible();
  await page.getByRole("button", { name: "Добавить участника" }).click();
  await page.getByLabel("Имя").fill("Маша");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Маша")).toBeVisible();

  // Family account and an expense attributed to Маша
  await page.keyboard.press("Control+3");
  await page.getByRole("button", { name: "Добавить счёт" }).first().click();
  await page.getByRole("dialog").getByLabel("Название").fill("Общая карта");
  await page.getByRole("dialog").getByLabel("Начальный баланс").fill("20000");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("Control+n");
  await page.getByLabel("Сумма").fill("700");
  await page.getByRole("dialog").getByLabel("Категория", { exact: true }).click();
  await page.getByRole("option", { name: "Дети" }).click();
  await page.getByRole("dialog").getByLabel("Участник").click();
  await page.getByRole("option", { name: "Маша" }).click();
  await page.getByTestId("tx-save").click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("Control+2");
  await expect(page.getByTestId("tx-row")).toHaveCount(1);
  await expect(page.getByTestId("tx-row")).toContainText("Маша");

  // Back to personal: the family operation is not there, and the choice survives a restart
  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: "Личный бюджет" }).click();
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Операций не найдено")).toBeVisible();

  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: "Семейный бюджет" }).click();
  const restarted = await app.restart();
  await expect(restarted.getByTestId("workspace-switcher")).toContainText("Семейный");
  await restarted.keyboard.press("Control+1");
  await expect(restarted.getByTestId("total-balance")).toContainText("19 300,00");
  await restarted.screenshot({ path: "test-results/05-family-dashboard.png" });
});

test("a third workspace can be created from the switcher", async ({ app }) => {
  const page = app.page;
  await onboard(page);
  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: "Новое пространство" }).click();
  await page.getByLabel("Название").fill("Дача");
  await page.getByRole("dialog").getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByTestId("workspace-switcher")).toContainText("Дача");
  await expect(page.getByRole("button", { name: "Участники семьи" })).toBeVisible();
});

test("a workspace can be deleted, but not the last one", async ({ app }) => {
  const page = app.page;
  await onboard(page);
  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: "Новое пространство" }).click();
  await page.getByLabel("Название").fill("Дача");
  await page.getByRole("dialog").getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByTestId("workspace-switcher")).toContainText("Дача");

  await page.getByRole("button", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Удалить пространство" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByText("Пространство удалено")).toBeVisible();
  await expect(page.getByTestId("workspace-switcher")).toContainText("Личный бюджет");
  await page.getByTestId("workspace-switcher").click();
  await expect(page.getByRole("menuitem", { name: "Дача" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // the only one left cannot be deleted, and a safety copy was saved
  await expect(page.getByRole("button", { name: "Удалить пространство" })).toHaveCount(0);
  await expect(page.getByText(/before-delete-/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/07-workspace-deleted.png" });
});
