import { expect, test, _electron as electron, type ElectronApplication } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./fixtures";

// This isolated renderer component test uses real React/UI components and a fake IPC boundary.
// It does not run the packaged app or use any account, native permission, or provider service.
test("event editor blocks reloads, recovers from a failed load, and ignores stale replies", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dayboard-editor-regression-"));
  let app: ElectronApplication | undefined;
  try {
    const profile = path.join(directory, "profile");
    await mkdir(profile);
    const fixture = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
    import { ItemEditButton } from ${JSON.stringify(path.join(root, "renderer/components/item-editor.tsx"))};
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    client.setQueryData(["fixture-scope"], "disposable-scope");
    let item = {id:"fixture-event",calendarId:"fixture-calendar",calendarName:"Fixture",calendarColor:null,
      title:"Summary",description:"",location:null,start:"2026-09-22T16:00:00.000Z",end:"2026-09-22T17:00:00.000Z",
      allDay:false,htmlLink:null,meetLink:null,attendees:[]};
    const requests = [], writes = [];
    const app = createRoot(document.getElementById("root"));
    const render = () => app.render(<QueryClientProvider client={client}><ItemEditButton item={item}/></QueryClientProvider>);
    window.editorFixture = {
      get pending(){return requests.length}, get writes(){return writes},
      replace(){ item={...item}; render(); },
      select(index){ item={...item,id:"fixture-event-"+index,calendarId:"fixture-calendar-"+index}; render(); },
      resolve(index,title){ requests[index].resolve({...requests[index].event,title,description:"Full details "+title}); },
      reject(index){ requests[index].reject(new Error("Temporary fixture failure")); },
      invoke(channel,payload){
        if(channel==="calendar:getForEditing") return new Promise((resolve,reject)=>requests.push({resolve,reject,event:{...item}}));
        if(channel==="calendar:update"){ writes.push(payload); return Promise.resolve({...item,...payload}); }
        return Promise.reject(new Error("Unexpected fixture operation"));
      }
    };
    render();
  `;
    await build({
      stdin: { contents: fixture, loader: "tsx", resolveDir: root },
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: path.join(directory, "fixture.js"),
      alias: { "@renderer": path.join(root, "renderer"), "@shared": path.join(root, "shared") },
      plugins: [
        {
          name: "editor-external-boundaries",
          setup(api) {
            api.onResolve({ filter: /^\.\.\/lib\/(ipc|queries|demo)$/ }, (args) => ({
              path: args.path.split("/").at(-1)!,
              namespace: "editor-fixture",
            }));
            api.onLoad({ filter: /.*/, namespace: "editor-fixture" }, (args) => ({
              loader: "js",
              contents:
                args.path === "ipc"
                  ? "export const invoke=(...args)=>window.editorFixture.invoke(...args); export const errorMessage=e=>e.message;"
                  : args.path === "demo"
                    ? "export const isRendererDemoMode=()=>false;"
                    : "export const queryKeys={agendaScope:['fixture-scope'],tasks:['tasks'],reminders:['reminders'],calendar:['calendar'],review:['review']};",
            }));
          },
        },
      ],
    });
    const assetFolder = path.join(root, "out/renderer/assets");
    const styles = (await readdir(assetFolder))
      .filter((file) => file.endsWith(".css"))
      .map(
        (file) =>
          `<link rel="stylesheet" href="${pathToFileURL(path.join(assetFolder, file)).href}">`,
      )
      .join("");
    await writeFile(
      path.join(directory, "fixture.html"),
      `<!doctype html><html><head>${styles}<title>Disposable event editor test</title></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`,
    );
    await writeFile(
      path.join(directory, "main.cjs"),
      `
    const {app,BrowserWindow}=require("electron");
    app.setPath("userData",${JSON.stringify(profile)});
    app.whenReady().then(()=>new BrowserWindow({show:false,width:1000,height:850,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}}).loadFile(${JSON.stringify(path.join(directory, "fixture.html"))}));
  `,
    );
    const environment = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]!]),
    );
    app = await electron.launch({ args: [path.join(directory, "main.cjs")], env: environment });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const control = async (
      action: "replace" | "select" | "resolve" | "reject",
      index = 0,
      title = "",
    ) => {
      await page.evaluate(
        ({ action, index, title }) => {
          const api = (
            globalThis as unknown as { editorFixture: Record<string, (...args: unknown[]) => void> }
          ).editorFixture;
          if (action === "replace") api.replace();
          else api[action](index, title);
        },
        { action, index, title },
      );
    };
    const pending = () =>
      page.evaluate(
        () =>
          (globalThis as unknown as { editorFixture: { pending: number } }).editorFixture.pending,
      );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect.poll(pending).toBe(1);
    await expect(save).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeDisabled();
    await control("resolve", 0, "First full event");
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "First full event",
    );
    await expect(save).toBeEnabled();

    await control("replace");
    await expect.poll(pending).toBe(2);
    await expect(save).toBeDisabled();
    await control("reject", 1);
    await expect(page.getByText(/Couldn’t load this event’s full details/)).toBeVisible();
    await control("replace");
    await expect.poll(pending).toBe(3);
    await expect(page.getByText(/Couldn’t load this event’s full details/)).toHaveCount(0);
    await expect(save).toBeDisabled();
    await control("resolve", 2, "Recovered event");
    await expect(save).toBeEnabled();

    await control("select", 2);
    await expect.poll(pending).toBe(4);
    await control("select", 3);
    await expect.poll(pending).toBe(5);
    await expect(save).toBeDisabled();
    await control("resolve", 4, "Newest event");
    await control("resolve", 3, "Late stale event");
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Newest event",
    );
    await save.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            globalThis as unknown as {
              editorFixture: { writes: { title: string; calendarId: string; eventId: string }[] };
            }
          ).editorFixture.writes.map(({ title, calendarId, eventId }) => ({
            title,
            calendarId,
            eventId,
          })),
        ),
      )
      .toEqual([
        { title: "Newest event", calendarId: "fixture-calendar-3", eventId: "fixture-event-3" },
      ]);
    expect(errors).toEqual([]);
  } finally {
    try {
      await app?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
