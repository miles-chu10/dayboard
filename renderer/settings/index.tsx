import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text, TooltipProvider, Toaster } from "@renderer/ui";
import { useTheme } from "@renderer/hooks";
import { applyCachedAppearance } from "../lib/appearance";
import { initializeDemoMode } from "../lib/demo";
import { SettingsView } from "./settings-view";
import { UpdateBoundary } from "../components/update-boundary";
import "../styles.css";

function ThemeSync() {
  useTheme();
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);
try {
  await initializeDemoMode();
  applyCachedAppearance();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeSync />
        <TooltipProvider>
          <UpdateBoundary>
            <SettingsView />
          </UpdateBoundary>
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </React.StrictMode>,
  );
} catch {
  root.render(
    <main className="h-full grid place-items-center p-8 text-center">
      <div>
        <Text as="h1" variant="heading2">
          DayBoard couldn’t start safely
        </Text>
        <Text as="p" variant="regular" color="secondary" className="mt-2">
          Quit DayBoard and reopen it to try again.
        </Text>
      </div>
    </main>,
  );
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
