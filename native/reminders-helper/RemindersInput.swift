import Foundation

enum HelperError: Error, CustomStringConvertible {
  case message(String)

  var description: String {
    switch self {
    case .message(let text): return text
    }
  }
}

struct EventTimeInput {
  let year: Int
  let month: Int
  let day: Int
  let hour: Int?
  let minute: Int?
  let second: Int?
  let timeZone: TimeZone?
}

private func parseDateOnly(_ date: String) throws -> (Int, Int, Int) {
  guard date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
    throw HelperError.message("invalid date \"\(date)\"")
  }
  let parts = date.split(separator: "-").compactMap { Int($0) }
  guard parts.count == 3, (1...9999).contains(parts[0]) else {
    throw HelperError.message("invalid date \"\(date)\"")
  }
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0)!
  let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
  guard components.isValidDate(in: calendar) else {
    throw HelperError.message("invalid date \"\(date)\"")
  }
  return (parts[0], parts[1], parts[2])
}

func parseEventTime(_ value: Any?) throws -> EventTimeInput? {
  guard let dict = value as? [String: Any] else { return nil }
  let kind = dict["kind"] as? String
  if kind == "date" {
    let (y, m, d) = try parseDateOnly(dict["date"] as? String ?? "")
    return EventTimeInput(year: y, month: m, day: d, hour: nil, minute: nil, second: nil, timeZone: nil)
  }
  if kind == "date-time" {
    let dateTime = dict["dateTime"] as? String ?? ""
    guard dateTime.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$"#, options: .regularExpression) != nil else {
      throw HelperError.message("invalid dateTime \"\(dateTime)\"")
    }
    let pieces = dateTime.split(separator: "T")
    let (y, m, d) = try parseDateOnly(String(pieces[0]))
    let timeParts = pieces[1].split(separator: ":").compactMap { Int($0) }
    guard timeParts.count >= 2,
      (0...23).contains(timeParts[0]),
      (0...59).contains(timeParts[1]),
      timeParts.count < 3 || (0...59).contains(timeParts[2])
    else {
      throw HelperError.message("invalid time in \"\(dateTime)\"")
    }
    let tz: TimeZone
    if let tzName = dict["timeZone"] as? String {
      guard let named = TimeZone(identifier: tzName) else {
        throw HelperError.message("invalid timeZone \"\(tzName)\"")
      }
      tz = named
    } else if dict["timeZone"] == nil || dict["timeZone"] is NSNull {
      tz = .current
    } else {
      throw HelperError.message("invalid timeZone")
    }
    return EventTimeInput(
      year: y, month: m, day: d,
      hour: timeParts[0], minute: timeParts[1], second: timeParts.count > 2 ? timeParts[2] : 0,
      timeZone: tz
    )
  }
  throw HelperError.message("invalid event time kind")
}

func toDateComponents(_ input: EventTimeInput) -> DateComponents {
  var components = DateComponents()
  components.calendar = Calendar(identifier: .gregorian)
  components.year = input.year
  components.month = input.month
  components.day = input.day
  if let hour = input.hour {
    components.hour = hour
    components.minute = input.minute
    components.second = input.second
    components.timeZone = input.timeZone
  }
  return components
}

func selectCalendar<T>(
  id: String?,
  lookup: (String) -> T?,
  defaultCalendar: () -> T?,
  isUsable: (T) -> Bool
) throws -> T {
  let calendar: T
  if let id {
    guard !id.isEmpty, let found = lookup(id) else {
      throw HelperError.message("Reminders list \"\(id)\" was not found.")
    }
    calendar = found
  } else {
    guard let found = defaultCalendar() else {
      throw HelperError.message("No default Reminders list is configured.")
    }
    calendar = found
  }
  guard isUsable(calendar) else {
    throw HelperError.message("Reminders list is not writable.")
  }
  return calendar
}
