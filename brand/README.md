# DayBoard logo

The logo is a Fraunces serif "D" in paper color (`#f6f2ea`) on ink (`#1d1b17`). Inside the letter sit three dots in the source colors: Calendar green `#22a23f`, Tasks blue `#007aff` and Reminders orange `#d07900`. It uses the website's display font and palette.

| File | Use |
|---|---|
| `dayboard-icon.svg`, `dayboard-icon-1024.png` | macOS app icon master: a squircle on Apple's 1024 grid (824 px body, 100 px margin, soft shadow). Source of `app-icon.png` and of the 64 px and larger `app-icon.icns` sizes |
| `dayboard-icon-small.svg`, `dayboard-icon-small-1024.png` | The same mark with a larger D and dots, for 32 px and smaller: the 16/32 `.icns` sizes, the favicon and the website header icon |
| `dayboard-icon-square.svg`, `dayboard-icon-square-1024.png` | Full-bleed square for surfaces that apply their own mask: the Apple touch icon, the Glaze app icon, social avatars and the Google OAuth consent-screen logo |

The SVGs embed Fraunces (SIL Open Font License, `website/assets/fonts/OFL-Fraunces.txt`) so they render without the font installed.

## Regenerating

1. Render an SVG at 1024 × 1024 with a transparent background, for example with headless Chrome: `--headless=new --window-size=1024,1024 --default-background-color=00000000 --screenshot=out.png file:///path/to/icon.html`, where the HTML page contains only the SVG. Chrome writes the PNG but may not exit on its own.
2. Build `app-icon.icns` with `iconutil -c icns DayBoard.iconset -o app-icon.icns`. Take `icon_16x16`, `icon_16x16@2x` and `icon_32x32` from the small master, and every larger size from the main master (resize with `sips -z`).
3. Website: `icon-32.png` and `icon-96.png` come from the small master, and `icon-180.png` from the square master.
