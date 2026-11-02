import { type Browser, type Page, chromium, test as base } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// End-to-end tests drive the real debug build (Rust core + WebView2) through the Chrome DevTools
// Protocol. Every test file gets a fresh, empty data folder: real user data is never touched.

const ROOT = path.resolve(import.meta.dirname, "..");
const EXE = path.join(ROOT, "src-tauri", "target", "debug", "family-budget.exe");
const DEV_URL = "http://localhost:1430";

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export interface AppHandle {
  page: Page;
  dataDir: string;
  /** Restarts the app on the same data folder (checks persistence); `whileStopped` runs in between. */
  restart: (whileStopped?: () => void) => Promise<Page>;
  /** Answers the next native file dialog with this path (debug builds only, see commands/data.rs). */
  answerDialog: (file: string) => void;
}

let port = 9400;

async function launch(dataDir: string): Promise<{ process: ChildProcess; browser: Browser; page: Page }> {
  const cdpPort = port++;
  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      FAMILY_BUDGET_DATA_DIR: dataDir,
      FAMILY_BUDGET_E2E: "1",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(dataDir, "webview"),
    },
    stdio: "ignore",
  });
  await waitFor(`http://127.0.0.1:${cdpPort}/json/version`, 60_000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("no browser context");
  let page = context.pages().find((p) => p.url().startsWith(DEV_URL));
  for (let i = 0; !page && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    page = context.pages().find((p) => p.url().startsWith(DEV_URL));
  }
  if (!page) throw new Error("app page not found");
  await page.waitForLoadState("domcontentloaded");
  return { process: child, browser, page };
}

async function close(run: { process: ChildProcess; browser: Browser }) {
  await run.browser.close().catch(() => undefined);
  run.process.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
}

export const test = base.extend<{ app: AppHandle }>({
  app: async ({}, use) => {
    await waitFor(DEV_URL, 60_000);
    const dataDir = mkdtempSync(path.join(tmpdir(), "family-budget-e2e-"));
    let run = await launch(dataDir);
    await use({
      get page() {
        return run.page;
      },
      dataDir,
      restart: async (whileStopped) => {
        await close(run);
        whileStopped?.();
        run = await launch(dataDir);
        return run.page;
      },
      answerDialog: (file) => writeFileSync(path.join(dataDir, "e2e-dialog.txt"), file),
    });
    await close(run);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  },
});

export { expect } from "@playwright/test";

/** Completes the first-run screen. */
export async function onboard(page: Page, opts: { family?: boolean } = {}) {
  await page.getByLabel("Как вас зовут").fill("Тестер");
  if (opts.family) await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.getByTestId("workspace-switcher").waitFor();
}
