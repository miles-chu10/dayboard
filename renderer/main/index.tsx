import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router, queryClient } from "./router";
import "../styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider, Toaster } from "@glaze/core/components";
import { initLogging } from "@glaze/core/utils";
import { applyCachedAppearance } from "../lib/appearance";
import { invoke } from "../lib/ipc";
import { setStorageNamespace } from "../lib/storage";

declare const __APP_DISPLAY_NAME__: string | undefined;

initLogging();
applyCachedAppearance();

document.title = __APP_DISPLAY_NAME__ || document.title;

// Get the root element
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

// Create React root and render once the storage namespace is known
const root = ReactDOM.createRoot(rootElement);
const demo = await invoke<boolean>("app:isDemo").catch(() => false);
if (demo) setStorageNamespace("demo:");
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Hot Module Replacement (HMR) support
if (import.meta.hot) {
  import.meta.hot.accept();
}
