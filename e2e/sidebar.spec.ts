import { expect, onboard, test } from "./app";

const navLabels = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Разделы" }).getByRole("button").allTextContents();

test("sidebar items can be reordered by dragging; hotkeys and restarts follow the order", async ({ app }) => {
  const page = app.page;
  await onboard(page);
  expect((await navLabels(page))[0]).toBe("Обзор");

  // drag "Цели накоплений" to the top
  await page.getByTestId("nav-Цели накоплений").dragTo(page.getByTestId("nav-Обзор"));
  await expect.poll(() => navLabels(page)).toEqual([
    "Цели накоплений",
    "Обзор",
    "Операции",
    "Счета",
    "Аналитика",
    "Бюджеты",
    "Регулярные платежи",
    "Категории",
    "Настройки",
  ]);
  // the lower group is reordered on its own
  await page.getByTestId("nav-Настройки").dragTo(page.getByTestId("nav-Категории"));
  await expect.poll(async () => (await navLabels(page)).slice(-2)).toEqual(["Настройки", "Категории"]);

  // Ctrl+1 opens the first item in the new order
  await page.keyboard.press("Control+1");
  await expect(page.getByTestId("nav-Цели накоплений")).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: "test-results/08-sidebar-order.png" });

  // the order survives a restart and can be reset in settings
  const restarted = await app.restart();
  expect((await navLabels(restarted))[0]).toBe("Цели накоплений");
  await restarted.getByTestId("nav-Настройки").click();
  await restarted.getByRole("button", { name: "Сбросить порядок" }).click();
  await expect.poll(async () => (await navLabels(restarted))[0]).toBe("Обзор");
  await expect(restarted.getByRole("button", { name: "Сбросить порядок" })).toBeDisabled();
});
