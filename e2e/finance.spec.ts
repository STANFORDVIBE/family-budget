import type { Page } from "@playwright/test";
import { expect, onboard, test } from "./app";

async function addAccount(page: Page, name: string, initial: string, currency?: string) {
  await page.keyboard.press("Control+3");
  await page.getByRole("button", { name: "Добавить счёт" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Название").fill(name);
  if (currency) {
    await dialog.getByLabel("Валюта").click();
    await page.getByRole("option", { name: new RegExp(`^${currency}`) }).click();
  }
  await dialog.getByLabel("Начальный баланс").fill(initial);
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();
}

function card(page: Page, name: string) {
  return page.getByTestId("account-card").filter({ has: page.getByText(name, { exact: true }) });
}

async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByRole("dialog").getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).first().click();
}

async function newOperation(page: Page, kind: string) {
  await page.keyboard.press("Control+n");
  await page.getByRole("dialog").getByRole("radio", { name: kind }).click();
}

test("transfers, refunds, adjustments, edit, delete and undo", async ({ app }) => {
  const page = app.page;
  await onboard(page);
  await addAccount(page, "Карта", "50 000");
  await addAccount(page, "Наличные", "1 000");

  // Expense with a remembered account
  await newOperation(page, "Расход");
  await pick(page, "Счёт", /Карта/);
  await page.getByLabel("Сумма").fill("2 500");
  await pick(page, "Категория", "Рестораны");
  await page.getByLabel("Комментарий").fill("Ужин с друзьями");
  await page.getByTestId("tx-save").click();
  await expect(card(page, "Карта")).toContainText("47 500,00");

  // Transfer with a fee: fee leaves the source account on top of the amount
  await newOperation(page, "Перевод");
  await pick(page, "Со счёта", /Карта/);
  await pick(page, "На счёт", /Наличные/);
  await page.getByLabel("Сумма").fill("5000");
  await page.getByText("Комиссия за перевод").click();
  await page.getByLabel("Комиссия", { exact: true }).fill("50");
  await page.getByTestId("tx-save").click();
  await expect(card(page, "Карта")).toContainText("42 450,00");
  await expect(card(page, "Наличные")).toContainText("6 000,00");

  // Refund returns money and lowers the restaurant spending
  await newOperation(page, "Возврат");
  await pick(page, "Счёт", /Карта/);
  await page.getByLabel("Сумма").fill("500");
  await pick(page, "Категория расхода", "Рестораны");
  await page.getByTestId("tx-save").click();
  await expect(card(page, "Карта")).toContainText("42 950,00");

  // Adjustment to the real balance
  await card(page, "Наличные").getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Скорректировать баланс" }).click();
  await page.getByLabel("Фактический баланс").fill("5800");
  await expect(page.getByRole("dialog")).toContainText("Изменение: −200,00");
  await page.getByTestId("tx-save").click();
  await expect(card(page, "Наличные")).toContainText("5 800,00");

  // Operations list: search, edit, delete + undo
  await page.keyboard.press("Control+f");
  await page.keyboard.type("друзьями");
  const rows = page.getByTestId("tx-row");
  await expect(rows).toHaveCount(1);
  await rows.first().getByText("Рестораны").click();
  await page.getByLabel("Сумма").fill("3000");
  await page.getByTestId("tx-save").click();
  await expect(page.getByText("Операция изменена")).toBeVisible();
  await expect(rows.first()).toContainText("3000,00".replace("3000", "3 000"));

  await rows.first().hover();
  await rows.first().getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Удалить" }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(rows).toHaveCount(1);

  await page.keyboard.press("Control+3");
  // 50 000 − 3 000 − 5 000 − 50 + 500
  await expect(card(page, "Карта")).toContainText("42 450,00");
  await page.screenshot({ path: "test-results/03-accounts.png" });
  await page.keyboard.press("Control+2");
  await page.getByLabel("Поиск", { exact: true }).fill("");
  await page.screenshot({ path: "test-results/04-operations.png" });
});

test("foreign currency account needs a rate once, then remembers it", async ({ app }) => {
  const page = app.page;
  await onboard(page);
  await addAccount(page, "Рубли", "100 000");
  await addAccount(page, "Доллары", "1 000", "USD");

  await page.keyboard.press("Control+1");
  // USD account has no rate yet: the total shows a warning
  await expect(page.getByText(/Нет курса для USD/)).toBeVisible();

  await newOperation(page, "Расход");
  await pick(page, "Счёт", /Доллары/);
  await page.getByLabel("Сумма").fill("10");
  await pick(page, "Категория", "Продукты");
  await page.getByTestId("tx-save").click();
  await expect(page.getByRole("dialog")).toContainText("Неверный курс");
  await page.getByLabel(/Курс к RUB/).fill("90,5");
  await page.getByTestId("tx-save").click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // 100 000 + (1 000 − 10) × 90,5 = 189 595
  await expect(page.getByTestId("total-balance")).toContainText("189 595,00");

  // Cross-currency transfer: the received amount is asked for
  await newOperation(page, "Перевод");
  await pick(page, "Со счёта", /Рубли/);
  await pick(page, "На счёт", /Доллары/);
  await page.getByLabel("Сумма").fill("9 050");
  await page.getByLabel("Зачислено").fill("100");
  await expect(page.getByRole("dialog")).toContainText("1 RUB = 0,011 USD");
  await page.getByTestId("tx-save").click();
  await page.keyboard.press("Control+3");
  await expect(card(page, "Доллары")).toContainText("1 090,00");
  await expect(card(page, "Рубли")).toContainText("90 950,00");
});
