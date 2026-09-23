// Captures the README gallery from the fictional demo. Build first: `DAYBOARD_TEST=1 npm run build`.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchDemo, root } from "../e2e/fixtures.ts";

const output = path.join(root, "docs", "screenshots");
const size = { width: 1280, height: 820 };
await mkdir(output, { recursive: true });

async function navigate(page, route) {
  const button = page
    .getByRole("button")
    .filter({ has: page.getByText(route, { exact: true }) })
    .first();
  await button.click();
  await page.locator(`[aria-current="page"]`).filter({ hasText: route }).first().waitFor();
}

async function capture(page, name) {
  if (await page.getByText("Something went wrong").count()) throw Error(`${name} failed to render`);
  const scheme = await page.evaluate(() =>
    globalThis.document.documentElement.classList.contains("dark"),
  );
  if (scheme !== name.startsWith("dark-")) throw Error(`${name} rendered in the wrong theme`);
  await page.mouse.move(0, 0);
  await delay(400);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  console.log(`captured ${name}.png`);
}

for (const theme of ["light", "dark"]) {
  // A fixed accent keeps the gallery independent of this Mac's settings.
  const profile = await mkdtemp(path.join(tmpdir(), "dayboard-screenshots-"));
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ general: { accent: "blue", detailView: "sidebar" } }),
  );
  const demo = await launchDemo(profile);
  try {
    const { page, app } = demo;
    // Playwright emulates prefers-color-scheme, so set it alongside the native theme.
    await app.evaluate(({ nativeTheme }, source) => (nativeTheme.themeSource = source), theme);
    await page.emulateMedia({ colorScheme: theme });
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
      const window = BrowserWindow.getAllWindows().find(
        (w) => !/settings/.test(w.webContents.getURL()),
      );
      window.setContentSize(width, height);
    }, size);
    await page
      .getByRole("button", { name: /^Agenda\b/ })
      .first()
      .waitFor();

    await navigate(page, "Agenda");
    await capture(page, `${theme}-agenda`);

    await navigate(page, "Calendar");
    for (const layout of ["Week", "Month"]) {
      await page.getByRole("radio", { name: layout, exact: true }).click();
      await capture(page, `${theme}-calendar-${layout.toLowerCase()}`);
    }

    await navigate(page, "Tasks");
    await capture(page, `${theme}-tasks`);

    await navigate(page, "Reminders");
    await capture(page, `${theme}-reminders`);

    await navigate(page, "Inbox");
    await page.getByRole("button", { name: "Open email from Priya Shah", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Email details" })
      .getByText("Hi Alex,")
      .waitFor();
    await capture(page, `${theme}-mail`);

    await navigate(page, "Assistant");
    await page.getByRole("button", { name: "New chat" }).click();
    await page
      .getByRole("textbox", { name: /^Message / })
      .fill("What should I focus on for the launch announcement?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.locator('[data-from="assistant"]').getByText("Sample answer").waitFor();
    await capture(page, `${theme}-assistant`);

    await page.evaluate(() => globalThis.dayboard.ipc.invoke("window:openSettings"));
    let settings;
    while (!(settings = app.windows().find((w) => /settings-window/.test(w.url()))))
      await delay(100);
    await settings.waitForLoadState("domcontentloaded");
    await settings.emulateMedia({ colorScheme: theme });
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    await capture(settings, `${theme}-settings`);

    if (demo.errors.length) throw Error(`Page errors: ${demo.errors.join("; ")}`);
  } finally {
    await demo.close(false);
    await rm(profile, { recursive: true, force: true });
  }
}
