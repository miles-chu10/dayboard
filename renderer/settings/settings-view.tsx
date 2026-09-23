import { useEffect, useState } from "react";
import {
  ScrollArea,
  Tabs,
  TabsContent,
  TabsRoot,
  TabsTrigger,
  Toolbar,
  ToolbarContent,
  ToolbarRow,
  ToolbarTitle,
} from "@renderer/ui";

import { useAppearanceSync } from "../lib/appearance";
import { useBackendSync } from "../lib/queries";
import { AITab } from "./ai-tab";
import { GeneralTab } from "./general-tab";
import { McpTab } from "./mcp-tab";
import { SourcesTab } from "./sources-tab";
import { LicenseTab } from "./license-tab";
import { UpdatesTab } from "./updates-tab";
import { isSettingsTab, type SettingsTab } from "@shared/settings-navigation";

const TAB_CONTENT_CLASS = "px-4 pb-8 pt-2 flex flex-col gap-8";

export function SettingsView() {
  useBackendSync();
  useAppearanceSync();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const requested = window.location.hash.slice(1);
    return isSettingsTab(requested) ? requested : "general";
  });
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("settings:selectTab", (payload) => {
        const requested =
          payload && typeof payload === "object" && "tab" in payload ? payload.tab : undefined;
        if (isSettingsTab(requested)) setTab(requested);
      }),
    [],
  );

  // Close settings window on Escape, unless an interactive element is focused or a popover is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper], [role='dialog']")) {
        return;
      }

      event.preventDefault();
      window.dayboard.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <TabsRoot
      value={tab}
      onValueChange={(value) => {
        if (isSettingsTab(value)) setTab(value);
      }}
      className="h-full"
    >
      <ScrollArea
        className="h-full"
        toolbar={
          <Toolbar>
            <ToolbarRow>
              <ToolbarContent>
                <ToolbarTitle>Settings</ToolbarTitle>
              </ToolbarContent>
            </ToolbarRow>
            <ToolbarRow className="overflow-x-auto">
              <Tabs variant="glass" className="mx-auto shrink-0">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="sources">Sources</TabsTrigger>
                <TabsTrigger value="ai">AI</TabsTrigger>
                <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
                <TabsTrigger value="license">License</TabsTrigger>
                <TabsTrigger value="updates">Updates</TabsTrigger>
              </Tabs>
            </ToolbarRow>
          </Toolbar>
        }
      >
        <TabsContent value="general" className={TAB_CONTENT_CLASS}>
          <GeneralTab />
        </TabsContent>
        <TabsContent value="sources" className={TAB_CONTENT_CLASS}>
          <SourcesTab />
        </TabsContent>
        <TabsContent value="ai" className={TAB_CONTENT_CLASS}>
          <AITab />
        </TabsContent>
        <TabsContent value="mcp" className={TAB_CONTENT_CLASS}>
          <McpTab />
        </TabsContent>
        <TabsContent value="license" className={TAB_CONTENT_CLASS}>
          <LicenseTab />
        </TabsContent>
        <TabsContent value="updates" className={TAB_CONTENT_CLASS}>
          <UpdatesTab />
        </TabsContent>
      </ScrollArea>
    </TabsRoot>
  );
}
