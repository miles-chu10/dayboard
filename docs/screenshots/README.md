# Screenshot gallery

Captured November 4, 2026 (Pacific) from DayBoard `1.3.0-beta.17`, app source
`c9979977d065c41fac164aecb2cb9bc48fd8c718`, using the repository's fictional demo fixtures.
The Home and Ask captures were added to `scripts/capture-screenshots.mjs` for this refresh.

Each theme includes Home, the docked Assistant, Agenda, Calendar week/month, Tasks, Reminders,
Inbox, the full Assistant and Settings. Main windows are 1280×820 logical pixels, captured at
2560×1640 on a Retina display. Settings uses its own window size.

Regenerate on macOS with `npm run screenshots`. The script builds with `DAYBOARD_TEST=1`, creates
a disposable demo profile for each theme, checks that profile isolation is active, waits for
fictional data and the expected theme, then closes the demo apps. It does not connect personal
sources or make live AI requests. Copy the resulting PNGs to `website/assets/screens/` for the site.

The PNGs are direct screenshots, without compositing or altered interface content. They show
demo responses and do not establish live provider or account acceptance.
