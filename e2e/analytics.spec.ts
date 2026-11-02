import type { Page } from "@playwright/test";
import { expect, onboard, test } from "./app";

async function operation(
  page: Page,
  kind: string,
  amount: string,
  category: string,
) {
  await page.keyboard.press("Control+n");
  await page.getByRole("dialog").getByRole("radio", { name: kind }).click();
  await page.getByLabel("Сумма").fill(amount);
  await page
    .getByRole("dialog")
    .getByLabel("Категория", { exact: true })
    .click();
  await page.getByRole("option", { name: category }).click();
  await page.getByTestId("tx-save").click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("analytics totals, category structure and drill-down to operations", async ({
  app,
}) => {
  const page = app.page;
  await onboard(page);
  await page.getByRole("button", { name: "Добавить счёт" }).click();
  await page.getByRole("dialog").getByLabel("Название").fill("Карта");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await operation(page, "Доход", "90000", "Зарплата");
  await operation(page, "Расход", "6000", "Продукты");
  await operation(page, "Расход", "4000", "Продукты");
  await operation(page, "Расход", "5000", "Транспорт");

  await page.keyboard.press("Control+4");
  await expect(
    page.getByRole("heading", { name: "Аналитика", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("+90 000,00 ₽").first()).toBeVisible();
  await expect(page.getByText("+75 000,00 ₽").first()).toBeVisible();

  // Expense structure: shares of 15 000
  const groceries = page.getByRole("button", { name: /Продукты/ }).first();
  await expect(groceries).toContainText("66,7 %");
  await expect(groceries).toContainText("10 000,00");
  await expect(
    page.getByRole("button", { name: /Транспорт/ }).first(),
  ).toContainText("33,3 %");
  await page.screenshot({ path: "test-results/08-analytics.png" });
  await page.getByText("Сравнение месяцев").scrollIntoViewIfNeeded();
  // The comparison is for the current month, not the last (future) month of the year
  await expect(
    page
      .getByRole("row", { name: /Продукты/ })
      .getByRole("cell")
      .nth(2),
  ).toHaveText("10 000,00 ₽");
  await page.screenshot({ path: "test-results/09-analytics-history.png" });

  // Click on a category opens its operations
  await groceries.click();
  await expect(page.getByTestId("tx-row")).toHaveCount(2);
  await expect(page.getByTestId("tx-row").first()).toContainText("Продукты");
});
