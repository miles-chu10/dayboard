import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text, TooltipProvider, Toaster } from "@renderer/ui";
import { useTheme } from "@renderer/hooks";
import { applyCachedAppearance, useAppearanceSync } from "../lib/appearance";
import { initializeDemoMode } from "../lib/demo";
import { useBackendSync } from "../lib/queries";
import { CapturePanel } from "./capture-panel";
import { panelSurface } from "./panel-ipc";
import "../styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: false } },
});

function PanelRoot() {
  useTheme();
  useBackendSync();
  useAppearanceSync();
  const surface = panelSurface();
  return surface === "capture" ? <CapturePanel /> : null;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
try {
  await initializeDemoMode();
  applyCachedAppearance();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PanelRoot />
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </React.StrictMode>,
  );
} catch {
  root.render(
    <main className="grid h-full place-items-center p-4 text-center">
      <Text as="p" variant="regular" color="secondary">
        DayBoard couldn’t start this panel. Quit DayBoard and reopen it.
      </Text>
    </main>,
  );
}
