import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export const connectionQueryKeys = {
  connection: ["connection"] as const,
  environment: ["environment"] as const,
};

export type EnvironmentInfo =
  | { type: "dev-server"; port: number; url: string }
  | { type: "built"; url: string }
  | { type: "app"; url: string };

/**
 * Standalone Electron has no separate dev-server/backend process to lose a connection to — the
 * IPC bridge is wired up by the preload before any renderer code runs. This reports "connected"
 * once `window.dayboard` is present and stays resolved; call sites only read `.error`.
 */
export function useConnection(): UseQueryResult<{ connected: boolean; backendPort: null }, Error> {
  return useQuery({
    queryKey: connectionQueryKeys.connection,
    queryFn: async () => {
      if (!window.dayboard) throw new Error("dayboard bridge is unavailable");
      return { connected: true, backendPort: null as null };
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Reports how the renderer was loaded, mirroring electron-vite's dev/build split. */
export function useEnvironment(): UseQueryResult<EnvironmentInfo | null, Error> {
  return useQuery({
    queryKey: connectionQueryKeys.environment,
    queryFn: async (): Promise<EnvironmentInfo | null> => {
      if (import.meta.env.DEV) {
        const url = import.meta.env.ELECTRON_RENDERER_URL as string | undefined;
        if (!url) return null;
        return {
          type: "dev-server",
          port: Number(new URL(url).port) || 0,
          url,
        };
      }
      return { type: "built", url: window.location.href };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
