# DayBoard 1.2.2

- Fixed: If Google was busy, creating or changing a task, event, or email could occasionally happen twice. DayBoard now retries only reads, never changes.
- Fixed: Opening a different calendar event while the editor was still loading could briefly show or save the previous event's details. Fields now stay locked until the event you opened has loaded.
- Fixed: Selecting an event in a search or filtered view could jump to a different copy of a repeated event.
- Fixed: Free-time suggestions no longer appear for impossible dates (such as February 30) or for work hours outside the day.
- Improved: Orange accent buttons, and green, teal, and graphite buttons in dark mode, now use dark labels so they're readable.
