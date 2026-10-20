// Which native windows are floating panels. Kept free of window code so the IPC guard can use it
// without importing BrowserWindow; panel-window.ts installs the window lookup at startup.

const panelWindowIds = new Set<string>();

export const PANEL_PAGE = "panel-window.html";

interface WindowLookup {
  fromSender(sender: unknown): { id: number | string } | null;
  fromId(id: string): { id: number | string } | null;
}

let lookup: WindowLookup | null = null;

export function setPanelWindowLookup(next: WindowLookup): void {
  lookup = next;
}

export function registerPanelWindow(id: number | string): void {
  panelWindowIds.add(String(id));
}

export function unregisterPanelWindow(id: number | string): void {
  panelWindowIds.delete(String(id));
}

export function isPanelWindowId(id: number | string | null | undefined): boolean {
  return id !== null && id !== undefined && panelWindowIds.has(String(id));
}

function isPanelPage(frameURL: string | undefined): boolean {
  return typeof frameURL === "string" && frameURL.includes(PANEL_PAGE);
}

/** An invoke comes from a panel when its window is registered as one or it loaded the panel page. */
export function isPanelInvoke(sender: unknown, frameURL: string | undefined): boolean {
  const window = lookup?.fromSender(sender) ?? null;
  return isPanelWindowId(window?.id) || isPanelPage(frameURL);
}

/** Glaze's stream sender carries the native window identifier, resolved to a window first. */
export function isPanelStream(
  sender: { windowId?: string; frameURL?: string } | undefined,
): boolean {
  const window = sender?.windowId ? (lookup?.fromId(sender.windowId) ?? null) : null;
  return isPanelWindowId(window?.id) || isPanelPage(sender?.frameURL);
}
