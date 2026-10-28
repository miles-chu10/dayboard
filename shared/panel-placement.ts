// Where the floating panels open, in screen coordinates. Pure so the Glaze port can reuse it.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

const EDGE = 8;
const BELOW_MENU_BAR = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Centred horizontally, in the upper fifth of the display's work area. */
export function capturePanelBounds(workArea: Rect, size: Size): Rect {
  const x = workArea.x + Math.round((workArea.width - size.width) / 2);
  const y = clamp(
    workArea.y + Math.round(workArea.height * 0.2),
    workArea.y,
    workArea.y + workArea.height - size.height,
  );
  return { x, y, width: size.width, height: size.height };
}

/** Under the menu-bar icon; when its bounds are unknown, at the top right of the work area. */
export function menuBarPanelBounds(trayBounds: Rect | null, workArea: Rect, size: Size): Rect {
  const minX = workArea.x + EDGE;
  const maxX = workArea.x + workArea.width - size.width - EDGE;
  const known = trayBounds !== null && trayBounds.width > 0 && trayBounds.height > 0;
  const x = known
    ? clamp(Math.round(trayBounds.x + trayBounds.width / 2 - size.width / 2), minX, maxX)
    : maxX;
  return {
    x,
    y: workArea.y + BELOW_MENU_BAR,
    width: size.width,
    height: size.height,
  };
}
