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

// Resolves once no skeleton is shown and the DOM has been unchanged for 300 ms, so a slow
// machine cannot capture a view that is still loading.
function settled() {
  const { document, MutationObserver } = globalThis;
  return new Promise((resolve, reject) => {
    const done = (error) => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(limit);
      if (error) reject(error);
      else resolve();
    };
    const check = () => (document.querySelector('[aria-busy="true"]') ? restart() : done());
    const restart = () => {
      clearTimeout(quiet);
      quiet = setTimeout(check, 300);
    };
    let quiet = setTimeout(check, 300);
    const limit = setTimeout(() => done(Error("view did not finish loading")), 10_000);
    const observer = new MutationObserver(restart);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
}

// The sidebar draws on every source, so these appear only once all of them have loaded.
function sidebarMarkers(page) {
  const count = (route, value) =>
    page
      .getByRole("button")
      .filter({ has: page.getByText(route, { exact: true }) })
      .filter({ hasText: value })
      .first();
  return [
    page.getByRole("button", { name: "Profile menu for Alex Rivera" }),
    page.getByText("Latest: Priya Shah"),
    count("Tasks", "10"),
    count("Reminders", "5"),
  ];
}

// `markers` are fictional items that only this view shows once its data has loaded.
async function capture(page, name, markers) {
  for (const marker of markers) await marker.waitFor();
  await page.mouse.move(0, 0);
  await page.evaluate(settled);
  if (await page.getByText("Something went wrong").count()) throw Error(`${name} failed to render`);
  const scheme = await page.evaluate(() =>
    globalThis.document.documentElement.classList.contains("dark"),
  );
  if (scheme !== name.startsWith("dark-")) throw Error(`${name} rendered in the wrong theme`);
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

    const sidebar = sidebarMarkers(page);

    await navigate(page, "Agenda");
    // Agenda hides past events and moves overdue reminders, so use items that stay put all day.
    await capture(page, `${theme}-agenda`, [
      ...sidebar,
      page.getByRole("group", { name: /^Launch week, / }),
      page.getByText("Finalize launch announcement", { exact: true }),
    ]);

    await navigate(page, "Calendar");
    await page.getByRole("radio", { name: "Week", exact: true }).click();
    await capture(page, `${theme}-calendar-week`, [
      ...sidebar,
      page.getByRole("button", { name: /^Q4 roadmap sync, / }),
    ]);
    await page.getByRole("radio", { name: "Month", exact: true }).click();
    await capture(page, `${theme}-calendar-month`, [
      ...sidebar,
      page.getByRole("grid", { name: "Month" }).getByText("Launch week"),
    ]);

    await navigate(page, "Tasks");
    await capture(page, `${theme}-tasks`, [
      ...sidebar,
      page.getByText("Update team wiki", { exact: true }),
    ]);

    await navigate(page, "Reminders");
    await capture(page, `${theme}-reminders`, [
      ...sidebar,
      page.getByText("Water the plants", { exact: true }),
    ]);

    await navigate(page, "Inbox");
    await page.getByRole("button", { name: "Open email from Priya Shah", exact: true }).click();
    await capture(page, `${theme}-mail`, [
      ...sidebar,
      page.getByRole("complementary", { name: "Email details" }).getByText("Hi Alex,"),
    ]);

    await navigate(page, "Assistant");
    await page.getByRole("button", { name: "New chat" }).click();
    await page
      .getByRole("textbox", { name: /^Message / })
      .fill("What should I focus on for the launch announcement?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await capture(page, `${theme}-assistant`, [
      ...sidebar,
      page.locator('[data-from="assistant"]').getByText("Sample answer"),
      page.getByText("Saved on this Mac"),
    ]);

    await page.evaluate(() => globalThis.dayboard.ipc.invoke("window:openSettings"));
    const settingsDeadline = Date.now() + 10_000;
    let settings = app.windows().find((w) => /settings-window/.test(w.url()));
    while (!settings && Date.now() < settingsDeadline) {
      await delay(100);
      settings = app.windows().find((w) => /settings-window/.test(w.url()));
    }
    if (!settings) throw Error("Settings window did not open within 10 seconds");
    await settings.waitForLoadState("domcontentloaded");
    await settings.emulateMedia({ colorScheme: theme });
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    await capture(settings, `${theme}-settings`, [
      settings.getByRole("radio", { name: theme === "dark" ? "Dark" : "Light", checked: true }),
      settings.getByRole("textbox", { name: "Your name" }),
    ]);

    if (demo.errors.length) throw Error(`Page errors: ${demo.errors.join("; ")}`);
  } finally {
    await demo.close(false);
    await rm(profile, { recursive: true, force: true });
  }
}
