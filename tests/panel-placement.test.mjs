import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { capturePanelBounds, menuBarPanelBounds } = await loadTs("shared/panel-placement.ts");

const laptop = { x: 0, y: 34, width: 1512, height: 888 };

test("centres the capture panel in the upper part of the display", () => {
  assert.deepEqual(capturePanelBounds(laptop, { width: 560, height: 140 }), {
    x: 476,
    y: 34 + 178,
    width: 560,
    height: 140,
  });
});

test("clamps the capture panel on a short display", () => {
  const short = { x: 0, y: 25, width: 800, height: 300 };
  const bounds = capturePanelBounds(short, { width: 560, height: 280 });
  assert.equal(bounds.y + bounds.height <= short.y + short.height, true);
  assert.equal(bounds.y >= short.y, true);
});

test("centres the menu-bar panel under the icon", () => {
  const tray = { x: 495, y: 0, width: 38, height: 33 };
  assert.deepEqual(menuBarPanelBounds(tray, laptop, { width: 360, height: 520 }), {
    x: 334,
    y: 40,
    width: 360,
    height: 520,
  });
});

test("keeps the menu-bar panel 8 px inside the right edge", () => {
  const tray = { x: 1480, y: 0, width: 30, height: 33 };
  const bounds = menuBarPanelBounds(tray, laptop, { width: 360, height: 520 });
  assert.equal(bounds.x, 1512 - 360 - 8);
});

test("falls back to the top-right of the work area when tray bounds are empty", () => {
  for (const tray of [{ x: 0, y: 0, width: 0, height: 0 }, null]) {
    assert.deepEqual(menuBarPanelBounds(tray, laptop, { width: 360, height: 520 }), {
      x: 1512 - 360 - 8,
      y: 40,
      width: 360,
      height: 520,
    });
  }
});

test("works on a secondary display with a negative origin", () => {
  const left = { x: -1920, y: 25, width: 1920, height: 1055 };
  const capture = capturePanelBounds(left, { width: 560, height: 140 });
  assert.equal(capture.x, -1920 + 680);
  const tray = { x: -200, y: 0, width: 30, height: 24 };
  const menu = menuBarPanelBounds(tray, left, { width: 360, height: 520 });
  assert.equal(menu.x, -1920 + 1920 - 360 - 8);
  assert.equal(menu.y, 31);
});
