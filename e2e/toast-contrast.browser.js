/* global document, getComputedStyle */
// Runs inside a DayBoard window (see mcp-server.spec.ts): the WCAG contrast of the first toast's
// title and icon against the toast, as painted over the window background.
// The file is one function expression that the spec evaluates in the page.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
() => {
  const toast = document.querySelector("[data-sonner-toast]");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("div");
  probe.className = "bg-background";
  document.body.append(probe);
  const windowColor = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const paint = (...colors) => {
    for (const color of [windowColor, ...colors]) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const background = getComputedStyle(toast).backgroundColor;
  const title = getComputedStyle(toast.querySelector("[data-title]")).color;
  const icon = getComputedStyle(toast.querySelector("[data-icon]")).color;
  const fill = paint(background);
  return {
    background,
    backgroundLuminance: luminance(fill),
    title: ratio(paint(background, title), fill),
    titleColor: title,
    icon: ratio(paint(background, icon), fill),
    iconColor: icon,
  };
};
