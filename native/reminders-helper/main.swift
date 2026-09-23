// DayBoard Reminders helper: a small EventKit CLI, line-delimited JSON over stdin/stdout.
// Re-implemented from the operations main/services/apple-reminders.ts uses and the data shapes
// documented in the Glaze SDK's `reminders.d.ts` (read for reference only; no source copied).
//
// Protocol: each stdin line is `{"id": string, "op": string, "params": object}`.
// Each stdout line is `{"id": string, "ok": true, "result": any}` or
// `{"id": string, "ok": false, "error": string}`. One line per request; stdout is flushed after
// every line so the parent process can read responses as they arrive.

import EventKit
import Foundation

let store = EKEventStore()

// MARK: - JSON helpers

typealias JSONObject = [String: Any]

func readLine_(from handle: FileHandle) -> String? {
  var lineData = Data()
  var byte: UInt8 = 0
  while true {
    let chunk = handle.readData(ofLength: 1)
    if chunk.isEmpty { return lineData.isEmpty ? nil : String(data: lineData, encoding: .utf8) }
    byte = chunk[0]
    if byte == 0x0A { return String(data: lineData, encoding: .utf8) }
    lineData.append(byte)
  }
}

func writeLine(_ object: JSONObject) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func obj(_ params: JSONObject, _ key: String) -> JSONObject {
  return (params[key] as? JSONObject) ?? [:]
}

func str(_ params: JSONObject, _ key: String) -> String? {
  return params[key] as? String
}

func requestedCalendarId(_ params: JSONObject) throws -> String? {
  guard let value = params["calendarId"] else { return nil }
  guard let id = value as? String, !id.isEmpty else {
    throw HelperError.message("\"calendarId\" must be a non-empty string")
  }
  return id
}

func requireStr(_ params: JSONObject, _ key: String) throws -> String {
  guard let value = params[key] as? String, !value.isEmpty else {
    throw HelperError.message("\"\(key)\" is required")
  }
  return value
}

func int(_ params: JSONObject, _ key: String) -> Int? {
  if let n = params[key] as? Int { return n }
  if let n = params[key] as? NSNumber { return n.intValue }
  return nil
}

func boolVal(_ params: JSONObject, _ key: String) -> Bool? {
  return params[key] as? Bool
}

// MARK: - EventTime encode/decode

func pad(_ n: Int, _ width: Int) -> String {
  var s = String(n)
  while s.count < width { s = "0" + s }
  return s
}

/// Encodes EventKit's `DateComponents` back to the wire `EventTime` shape.
func encodeEventTime(_ components: DateComponents?) -> Any {
  guard let c = components, let y = c.year, let m = c.month, let d = c.day else { return NSNull() }
  guard let hour = c.hour, let minute = c.minute else {
    return ["kind": "date", "date": "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))"]
  }
  let second = c.second ?? 0
  let dateTime = "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))T\(pad(hour, 2)):\(pad(minute, 2)):\(pad(second, 2))"
  return ["kind": "date-time", "dateTime": dateTime, "timeZone": c.timeZone?.identifier as Any]
}

let isoFormatter: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  return formatter
}()

func encodeInstant(_ date: Date?) -> Any {
  guard let date = date else { return NSNull() }
  return isoFormatter.string(from: date)
}

// MARK: - Reminder / Calendar encoding

func refValue(_ reminder: EKReminder) -> String {
  return reminder.calendarItemIdentifier
}

func encodeReminder(_ reminder: EKReminder) -> JSONObject {
  return [
    "ref": ["value": refValue(reminder)],
    "externalId": reminder.calendarItemExternalIdentifier as Any,
    "calendarId": reminder.calendar?.calendarIdentifier ?? "",
    "title": reminder.title ?? "",
    "location": reminder.location as Any,
    "notes": reminder.notes as Any,
    "url": reminder.url?.absoluteString as Any,
    "creationDate": encodeInstant(reminder.creationDate),
    "lastModifiedDate": encodeInstant(reminder.lastModifiedDate),
    "start": encodeEventTime(reminder.startDateComponents),
    "due": encodeEventTime(reminder.dueDateComponents),
    "isCompleted": reminder.isCompleted,
    "completionDate": encodeInstant(reminder.completionDate),
    "priority": reminder.priority,
    "alarms": [],
    "recurrenceRules": (reminder.recurrenceRules ?? []).map { rule -> JSONObject in
      let frequency: String
      switch rule.frequency {
      case .daily: frequency = "daily"
      case .weekly: frequency = "weekly"
      case .monthly: frequency = "monthly"
      case .yearly: frequency = "yearly"
      @unknown default: frequency = "daily"
      }
      return [
        "calendarIdentifier": reminder.calendar?.calendarIdentifier ?? "",
        "frequency": frequency,
        "interval": rule.interval,
        "firstDayOfWeek": NSNull(),
        "daysOfTheWeek": [],
        "daysOfTheMonth": [],
        "daysOfTheYear": [],
        "weeksOfTheYear": [],
        "monthsOfTheYear": [],
        "setPositions": [],
        "end": NSNull(),
      ]
    },
  ]
}

func encodeCalendar(_ calendar: EKCalendar) -> JSONObject {
  return [
    "id": calendar.calendarIdentifier,
    "title": calendar.title,
    "color": calendar.cgColor.flatMap { color -> String? in
      guard let components = color.components, components.count >= 3 else { return nil }
      let r = Int(components[0] * 255), g = Int(components[1] * 255), b = Int(components[2] * 255)
      return String(format: "#%02x%02x%02x", r, g, b)
    } as Any,
    "type": "local",
    "source": calendar.source?.title as Any,
    "sourceId": calendar.source?.sourceIdentifier ?? "",
    "entityTypes": ["reminder"],
    "supportedAvailabilities": [],
    "allowsContentModifications": calendar.allowsContentModifications,
    "isSubscribed": calendar.isSubscribed,
    "isImmutable": calendar.isImmutable,
  ]
}

// MARK: - Operations

func authStatusName(_ status: EKAuthorizationStatus) -> String {
  switch status {
  case .notDetermined: return "not-determined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  case .fullAccess: return "full-access"
  default: return "unknown"
  }
}

func opStatus() -> JSONObject {
  let status = EKEventStore.authorizationStatus(for: .reminder)
  return ["result": authStatusName(status)]
}

func opRequestAccess() throws -> JSONObject {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  var failure: Error?
  store.requestFullAccessToReminders { ok, error in
    granted = ok
    failure = error
    semaphore.signal()
  }
  semaphore.wait()
  if let failure = failure { throw HelperError.message(failure.localizedDescription) }
  let status = EKEventStore.authorizationStatus(for: .reminder)
  return ["result": authStatusName(granted ? .fullAccess : status)]
}

func requireCalendar(_ id: String?) throws -> EKCalendar {
  return try selectCalendar(
    id: id,
    lookup: { store.calendar(withIdentifier: $0) },
    defaultCalendar: { store.defaultCalendarForNewReminders() },
    isUsable: {
      $0.allowedEntityTypes.contains(.reminder) && $0.allowsContentModifications && !$0.isSubscribed && !$0.isImmutable
    }
  )
}

func findReminder(ref: String) throws -> EKReminder {
  guard let item = store.calendarItem(withIdentifier: ref) as? EKReminder else {
    throw HelperError.message("Reminder \"\(ref)\" was not found.")
  }
  return item
}

func fetchReminders(calendars: [EKCalendar]?, completed: Bool?) throws -> [EKReminder] {
  let predicate: NSPredicate
  if completed == true {
    predicate = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
  } else {
    predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
  }
  let semaphore = DispatchSemaphore(value: 0)
  var results: [EKReminder] = []
  store.fetchReminders(matching: predicate) { reminders in
    results = reminders ?? []
    semaphore.signal()
  }
  semaphore.wait()
  return results
}

func opGetCalendars() -> JSONObject {
  let calendars = store.calendars(for: .reminder).map(encodeCalendar)
  return ["result": calendars]
}

func opGetReminders(_ params: JSONObject) throws -> JSONObject {
  let completed = boolVal(params, "completed")
  let limit = int(params, "limit") ?? 200
  let all = try fetchReminders(calendars: nil, completed: completed)
  let page = pageReminders(
    all, completed: completed == true, limit: limit,
    dueDate: { $0.dueDateComponents?.date }, completionDate: { $0.completionDate }
  )
  return ["result": ["reminders": page.items.map(encodeReminder), "truncated": page.truncated]]
}

func opGetReminder(_ params: JSONObject) throws -> JSONObject {
  let ref = try requireStr(obj(params, "reference"), "value")
  return ["result": encodeReminder(try findReminder(ref: ref))]
}

func applyPatch(_ reminder: EKReminder, _ patch: JSONObject) throws {
  if let title = str(patch, "title") { reminder.title = title }
  if patch["calendarId"] != nil { reminder.calendar = try requireCalendar(requestedCalendarId(patch)) }
  if let priority = int(patch, "priority") { reminder.priority = priority }
  if let notes = str(patch, "notes") { reminder.notes = notes }
  if let location = str(patch, "location") { reminder.location = location }
  if let urlString = str(patch, "url") { reminder.url = URL(string: urlString) }
  if let isCompleted = boolVal(patch, "isCompleted") { reminder.isCompleted = isCompleted }
  if let due = try parseEventTime(patch["due"]) { reminder.dueDateComponents = toDateComponents(due) }
  if let start = try parseEventTime(patch["start"]) { reminder.startDateComponents = toDateComponents(start) }

  let clearFields = (patch["clearFields"] as? [String]) ?? []
  for field in clearFields {
    switch field {
    case "notes": reminder.notes = nil
    case "url": reminder.url = nil
    case "location": reminder.location = nil
    case "start": reminder.startDateComponents = nil
    case "due": reminder.dueDateComponents = nil
    case "completionDate": reminder.completionDate = nil
    case "alarms": reminder.alarms = nil
    case "recurrenceRules": reminder.recurrenceRules = nil
    default: break
    }
  }
}

func opCreateReminder(_ params: JSONObject) throws -> JSONObject {
  let input = obj(params, "input")
  let reminder = EKReminder(eventStore: store)
  reminder.calendar = try requireCalendar(requestedCalendarId(input))
  try applyPatch(reminder, input)
  guard let title = str(input, "title"), !title.isEmpty else {
    throw HelperError.message("\"title\" is required")
  }
  reminder.title = title
  try store.save(reminder, commit: true)
  return ["result": encodeReminder(reminder)]
}

func opUpdateReminder(_ params: JSONObject) throws -> JSONObject {
  let ref = try requireStr(obj(params, "reference"), "value")
  let reminder = try findReminder(ref: ref)
  try applyPatch(reminder, obj(params, "patch"))
  try store.save(reminder, commit: true)
  return ["result": encodeReminder(reminder)]
}

func opDeleteReminder(_ params: JSONObject) throws -> JSONObject {
  let ref = try requireStr(obj(params, "reference"), "value")
  let reminder = try findReminder(ref: ref)
  try store.remove(reminder, commit: true)
  return ["result": NSNull()]
}

func handle(op: String, params: JSONObject) throws -> JSONObject {
  switch op {
  case "status": return opStatus()
  case "requestAccess": return try opRequestAccess()
  case "getCalendars": return opGetCalendars()
  case "getReminders": return try opGetReminders(params)
  case "getReminder": return try opGetReminder(params)
  case "createReminder": return try opCreateReminder(params)
  case "updateReminder": return try opUpdateReminder(params)
  case "deleteReminder": return try opDeleteReminder(params)
  default:
    throw HelperError.message("Unknown operation \"\(op)\"")
  }
}

// MARK: - Main loop

setbuf(stdout, nil)
let stdin = FileHandle.standardInput
while let line = readLine_(from: stdin) {
  let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { continue }
  guard
    let data = trimmed.data(using: .utf8),
    let request = try? JSONSerialization.jsonObject(with: data) as? JSONObject,
    let id = request["id"] as? String,
    let op = request["op"] as? String
  else {
    writeLine(["id": NSNull(), "ok": false, "error": "Malformed request"])
    continue
  }
  let params = (request["params"] as? JSONObject) ?? [:]
  do {
    let response = try handle(op: op, params: params)
    var out: JSONObject = ["id": id, "ok": true]
    out["result"] = response["result"] ?? NSNull()
    writeLine(out)
  } catch {
    writeLine(["id": id, "ok": false, "error": String(describing: error)])
  }
}
