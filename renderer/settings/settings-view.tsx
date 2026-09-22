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
} from "@glaze/core/components";

import { useAppearanceSync } from "../lib/appearance";
import { useBackendSync } from "../lib/queries";
import { AITab } from "./ai-tab";
import { GeneralTab } from "./general-tab";
import { McpTab } from "./mcp-tab";
import { SourcesTab } from "./sources-tab";

const TAB_CONTENT_CLASS = "px-4 pb-8 pt-2 flex flex-col gap-8";

export function SettingsView() {
  useBackendSync();
  useAppearanceSync();
  const [tab, setTab] = useState("general");

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
      window.glazeAPI.glaze.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <TabsRoot value={tab} onValueChange={setTab} className="h-full">
      <ScrollArea
        className="h-full"
        toolbar={
          <Toolbar>
            <ToolbarRow>
              <ToolbarContent>
                <ToolbarTitle>Settings</ToolbarTitle>
              </ToolbarContent>
            </ToolbarRow>
            <ToolbarRow className="justify-center">
              <Tabs variant="glass">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="sources">Sources</TabsTrigger>
                <TabsTrigger value="ai">AI</TabsTrigger>
                <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
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
      </ScrollArea>
    </TabsRoot>
  );
}
