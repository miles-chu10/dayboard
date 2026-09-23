import EventKit
import Foundation

@main
struct RemindersInputFixture {
  static func checkRejects(_ value: [String: Any]) {
    do {
      _ = try parseEventTime(value)
      fatalError("Accepted invalid event time: \(value)")
    } catch is HelperError {
      // Expected validation failure.
    } catch {
      fatalError("Unexpected error: \(error)")
    }
  }

  static func main() throws {
    let date = try parseEventTime(["kind": "date", "date": "2024-02-29"])!
    let dateComponents = toDateComponents(date)
    precondition(dateComponents.calendar?.identifier == .gregorian)
    precondition(dateComponents.year == 2024 && dateComponents.month == 2 && dateComponents.day == 29)

    let timed = try parseEventTime([
      "kind": "date-time", "dateTime": "2025-03-16T09:04:05", "timeZone": "America/Los_Angeles",
    ])!
    let timedComponents = toDateComponents(timed)
    precondition(timedComponents.calendar?.identifier == .gregorian)
    precondition(timedComponents.hour == 9 && timedComponents.minute == 4 && timedComponents.second == 5)
    precondition(timedComponents.timeZone?.identifier == "America/Los_Angeles")

    // An unsaved reminder exercises EventKit's due date setter without permission or store access.
    let reminder = EKReminder(eventStore: EKEventStore())
    reminder.dueDateComponents = timedComponents
    precondition(reminder.dueDateComponents?.calendar?.identifier == .gregorian)
    precondition(reminder.dueDateComponents?.timeZone?.identifier == "America/Los_Angeles")

    for invalid in ["2023-02-29", "2024-13-01", "2024-00-01", "2024-02-30", "2024-2-09", "2024-01-01x"] {
      checkRejects(["kind": "date", "date": invalid])
    }
    for invalid in ["2024-01-01T24:00", "2024-01-01T12:60", "2024-01-01T12:30:60", "2024-01-01T12:30:01junk", "2024-01-01T12"] {
      checkRejects(["kind": "date-time", "dateTime": invalid, "timeZone": "UTC"])
    }
    checkRejects(["kind": "date-time", "dateTime": "2024-01-01T12:30", "timeZone": "No/Such_Zone"])
    checkRejects(["kind": "unknown", "date": "2024-01-01"])

    struct List { let id: String; let writable: Bool; let supportsReminders: Bool }
    let lists = [
      "valid": List(id: "valid", writable: true, supportsReminders: true),
      "readonly": List(id: "readonly", writable: false, supportsReminders: true),
      "events": List(id: "events", writable: true, supportsReminders: false),
    ]
    var defaultLookups = 0
    func choose(_ id: String?) throws -> List {
      try selectCalendar(
        id: id,
        lookup: { lists[$0] },
        defaultCalendar: { defaultLookups += 1; return lists["valid"] },
        isUsable: { $0.writable && $0.supportsReminders }
      )
    }
    let explicit = try choose("valid")
    precondition(explicit.id == "valid")
    for invalid in ["missing", "readonly", "events", ""] {
      do {
        _ = try choose(invalid)
        fatalError("Accepted invalid list: \(invalid)")
      } catch is HelperError {
        precondition(defaultLookups == 0)
      }
    }
    let fallback = try choose(nil)
    precondition(fallback.id == "valid")
    precondition(defaultLookups == 1)

    struct ReminderDateFixture {
      let id: String
      let dueDate: Date?
      let completionDate: Date?
    }
    let oldDue = Date(timeIntervalSince1970: 1_000)
    let recentDue = Date(timeIntervalSince1970: 2_000)
    let oldCompletion = Date(timeIntervalSince1970: 3_000)
    let recentCompletion = Date(timeIntervalSince1970: 4_000)
    let newestCompletion = Date(timeIntervalSince1970: 5_000)
    let completed = (0..<401).map {
      ReminderDateFixture(id: "old-\($0)", dueDate: oldDue, completionDate: oldCompletion)
    } + [
      ReminderDateFixture(id: "recent", dueDate: recentDue, completionDate: recentCompletion),
      ReminderDateFixture(id: "newest", dueDate: recentDue, completionDate: newestCompletion),
      ReminderDateFixture(id: "missing-date", dueDate: oldDue, completionDate: nil),
    ]
    let completedPage = pageReminders(
      completed, completed: true, limit: 400,
      dueDate: { $0.dueDate }, completionDate: { $0.completionDate }
    )
    precondition(completedPage.truncated)
    precondition(completedPage.items.count == 400)
    precondition(completedPage.items.prefix(2).map(\.id) == ["newest", "recent"])
    precondition(!completedPage.items.contains { $0.id == "missing-date" })
    let fullCompletedPage = pageReminders(
      completed, completed: true, limit: completed.count,
      dueDate: { $0.dueDate }, completionDate: { $0.completionDate }
    )
    precondition(!fullCompletedPage.truncated)
    precondition(fullCompletedPage.items.last?.id == "missing-date")

    let incomplete = [
      ReminderDateFixture(id: "undated", dueDate: nil, completionDate: newestCompletion),
      ReminderDateFixture(id: "later", dueDate: recentDue, completionDate: oldCompletion),
      ReminderDateFixture(id: "earlier", dueDate: oldDue, completionDate: nil),
    ]
    let incompletePage = pageReminders(
      incomplete, completed: false, limit: 3,
      dueDate: { $0.dueDate }, completionDate: { $0.completionDate }
    )
    precondition(!incompletePage.truncated)
    precondition(incompletePage.items.map(\.id) == ["earlier", "later", "undated"])
    print("native Reminders input fixture passed")
  }
}
