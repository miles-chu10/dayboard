# DayBoard 1.1.0

- Personalize your Agenda with accent colors, Default or Compact density, and Pop-up, Inline, or Side panel details.
- Find overdue work at the top of your day, with clear task labels and color-coded calendar events.
- Link duplicate Google Tasks and Apple Reminders to see them together and complete linked items from DayBoard.
- Keep saved links and focus choices across relaunches, with clearer handling when a linked item is unavailable.
- Get more accurate completion feedback and Undo when only some linked items can be updated.
- Edit or delete individual Google Tasks, Apple Reminders, and Calendar events directly in DayBoard. Preserve calendar formatting when the description is unchanged, and reminder time zones when the deadline is unchanged.
- Use an isolated sample-data mode to prepare screenshots without showing personal information or contacting AI providers.

Linked completion applies to checkbox actions performed in DayBoard, not external apps or individual MCP writes. It updates available partners that share the original completion state. Undo restores only successful participants and never reopens a partner that was already complete. Editing/deleting affects only the selected source item. Calendar operations affect one occurrence. Recurring Apple Reminder edit/delete is unavailable because the native SDK does not expose a safe occurrence-only operation; Undo is unavailable when completion advances to the next occurrence.
