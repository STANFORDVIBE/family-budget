import type { Page } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, onboard, test } from "./app";

async function setup(page: Page) {
  await onboard(page);
  await page.getByRole("button", { name: "Добавить счёт" }).click();
  await page.getByRole("dialog").getByLabel("Название").fill("Карта");
  await page.getByRole("dialog").getByLabel("Начальный баланс").fill("10000");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Настройки" }).click();
  await expect(page.getByRole("heading", { name: "Настройки", level: 1 })).toBeVisible();
}

test("backup, export, restore and integrity check", async ({ app }) => {
  const page = app.page;
  await setup(page);

  await openSettings(page);
  await page.getByTestId("backup-now").click();
  await expect(page.getByText(/Копия создана/)).toBeVisible();

  // A change made after the backup
  await page.keyboard.press("Control+n");
  await page.getByLabel("Сумма").fill("3000");
  await page.getByRole("dialog").getByLabel("Категория", { exact: true }).click();
  await page.getByRole("option", { name: "Продукты" }).click();
  await page.getByTestId("tx-save").click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // CSV export of the operations
  const csv = path.join(app.dataDir, "operations.csv");
  await page.keyboard.press("Control+2");
  app.answerDialog(csv);
  await page.getByRole("button", { name: "Экспорт в CSV" }).click();
  await expect(page.getByText("Файл сохранён: operations.csv")).toBeVisible();
  const lines = readFileSync(csv, "utf-8").trim().split(/\r?\n/);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("Продукты");

  // JSON export of the whole workspace
  const json = path.join(app.dataDir, "workspace.json");
  await openSettings(page);
  app.answerDialog(json);
  await page.getByRole("button", { name: "Экспорт пространства (JSON)" }).click();
  await expect(page.getByText("Сохранено: workspace.json")).toBeVisible();
  const exported = readFileSync(json, "utf-8");
  expect(exported).toContain("Карта");
  expect(exported).toContain("300000");

  // Restore the backup: the expense disappears, a safety copy of the current state is made
  await page.getByRole("button", { name: "Восстановить", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Восстановить" }).click();
  await expect(page.getByText(/Данные восстановлены/)).toBeVisible();
  await page.keyboard.press("Control+1");
  await expect(page.getByTestId("total-balance")).toContainText("10 000,00");

  await openSettings(page);
  await expect(page.getByText("Последняя копия: ещё не было")).toHaveCount(0);
  await page.getByRole("button", { name: "Проверить базу" }).click();
  await expect(page.getByText("Проблем не найдено")).toBeVisible();
  await page.screenshot({ path: "test-results/10-settings.png" });
});

test("a broken database opens the recovery screen and is restored from a backup", async ({ app }) => {
  const page = app.page;
  await setup(page);
  await openSettings(page);
  await page.getByTestId("backup-now").click();
  await expect(page.getByText(/Копия создана/)).toBeVisible();

  const backups = path.join(app.dataDir, "backups");
  const backup = readdirSync(backups).find((f) => f.endsWith(".fbbak"));
  if (!backup) throw new Error("no backup file");

  const db = path.join(app.dataDir, "family-budget.db");
  const broken = await app.restart(() => {
    writeFileSync(db, "definitely not a database ".repeat(400));
    for (const suffix of ["-wal", "-shm"]) rmSync(db + suffix, { force: true });
  });
  await expect(broken.getByText("Не удалось открыть базу данных")).toBeVisible();
  await broken.screenshot({ path: "test-results/11-recovery.png" });

  app.answerDialog(path.join(backups, backup));
  await broken.getByRole("button", { name: "Восстановить из резервной копии" }).click();
  await expect(broken.getByTestId("workspace-switcher")).toBeVisible();
  await broken.keyboard.press("Control+3");
  await expect(broken.getByTestId("account-card")).toContainText("10 000,00");
  // The broken file is kept next to the database, never deleted
  expect(readdirSync(app.dataDir).some((f) => f.startsWith("broken-"))).toBe(true);
  expect(existsSync(db)).toBe(true);
});
