import { performance } from "node:perf_hooks";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchDemo, root } from "../e2e/fixtures.ts";

const started = performance.now();
const demo = await launchDemo();
try {
  await demo.page
    .getByRole("button", { name: /^Agenda\b/ })
    .first()
    .waitFor();
  const readyMs = Math.round(performance.now() - started);
  await demo.app.evaluate(({ app }) => app.getAppMetrics());
  await delay(2000);
  const measurements = await demo.app.evaluate(({ app }) => ({
    version: app.getVersion(),
    processes: app.getAppMetrics().map(({ type, cpu, memory }) => ({
      type,
      cpuPercent: cpu.percentCPUUsage,
      workingSetKiB: memory.workingSetSize,
    })),
  }));
  const report = {
    mode: "fictional demo, new process with warm OS caches",
    architecture: process.arch,
    packaged: Boolean(process.env.DAYBOARD_E2E_EXECUTABLE),
    readyMs,
    ...measurements,
    totalWorkingSetMiB: Math.round(
      measurements.processes.reduce((sum, p) => sum + p.workingSetKiB, 0) / 1024,
    ),
    totalCpuPercent: measurements.processes.reduce((sum, p) => sum + p.cpuPercent, 0),
    note: "Working sets are summed across processes and may double-count shared pages. This is an idle demo measurement, not a production-load benchmark.",
  };
  const output = path.join(root, "test-results", "measurements.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (process.argv.includes("--inspect")) {
    const before = await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    const signal = path.join(demo.profile, "inspection-complete");
    console.log(`Native preview ready. Close signal: ${signal}`);
    const deadline = Date.now() + 120000;
    while (!existsSync(signal) && Date.now() < deadline) await delay(500);
    const after = await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    const inspection = { before, after, moved: before.x !== after.x || before.y !== after.y };
    await writeFile(
      path.join(root, "test-results", "native-inspection.json"),
      `${JSON.stringify(inspection, null, 2)}\n`,
    );
    console.log(JSON.stringify({ inspection }));
  }
} finally {
  await demo.close();
}
