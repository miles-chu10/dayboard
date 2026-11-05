// A separate, in-memory sample. This module has no connection to DayBoard or provider accounts.
export function createDemoState() {
  return {
    nextTask: 4,
    tasks: [
      {
        id: "t1",
        title: "Finalize launch announcement",
        source: "Tasks",
        due: "Today",
        done: false,
      },
      { id: "t2", title: "Review pull request", source: "Tasks", due: "Today", done: false },
      { id: "t3", title: "Pick up dry cleaning", source: "Reminders", due: "5:30 PM", done: false },
    ],
    suggestions: [
      { id: "s1", title: "Review launch copy", from: "Priya Shah · Launch announcement" },
      {
        id: "s2",
        title: "Submit the Q4 budget",
        from: "Finance Team · Reminder: Q4 budget due Friday",
      },
    ],
    mail: [
      {
        id: "m1",
        from: "Priya Shah",
        initials: "PS",
        subject: "Launch announcement — final copy?",
        time: "9:42 AM",
        triage: "Needs reply",
        status: "inbox",
        body: "Hi Alex,\n\nThe launch copy is ready for a final pass. Could you review the headline and send your thoughts before the roadmap sync?\n\nThanks,\nPriya",
      },
      {
        id: "m2",
        from: "Sam Patel",
        initials: "SP",
        subject: "Lunch today?",
        time: "Yesterday",
        triage: "Needs reply",
        status: "inbox",
        body: "Hey Alex,\n\nStill on for lunch at noon? I found a new place near the office. Let me know and I’ll grab a table.\n\nSam",
      },
      {
        id: "m3",
        from: "Jordan Lee",
        initials: "JL",
        subject: "Our 1:1 agenda",
        time: "8:30 AM",
        triage: "FYI",
        status: "inbox",
        body: "Hi Alex,\n\nFor tomorrow’s 1:1, let’s cover launch progress, what’s blocked and next week’s priorities. Add anything else you’d like to discuss.\n\nJordan",
      },
    ],
    note: "# Launch checklist\n\n- Review the final copy with Priya\n- Confirm the launch timeline\n- Share the announcement\n\n## Notes from the team\nKeep the message clear and practical.",
  };
}

export const demoMeetings = Object.freeze([
  {
    id: "e1",
    day: "Today",
    time: "9:30 AM",
    end: "10:00 AM",
    title: "Team standup",
    detail: "Progress, plans and anything in the way.",
    color: "green",
  },
  {
    id: "e2",
    day: "Today",
    time: "12:00 PM",
    end: "1:00 PM",
    title: "Lunch with Sam",
    detail: "Catch up over lunch near the office.",
    color: "orange",
  },
  {
    id: "e3",
    day: "Today",
    time: "3:00 PM",
    end: "4:00 PM",
    title: "Q4 roadmap sync",
    detail: "Review launch plans, owners and the next milestone.",
    color: "blue",
  },
  {
    id: "e4",
    day: "Tomorrow",
    time: "11:00 AM",
    end: "11:30 AM",
    title: "1:1 with Jordan",
    detail: "Launch progress, blockers and next week’s priorities.",
    color: "blue",
  },
]);

export function reduceDemo(state, action) {
  if (action.type === "reset") return createDemoState();
  const next = structuredClone(state);
  if (action.type === "toggle-task") {
    const task = next.tasks.find((item) => item.id === action.id);
    if (task) task.done = !task.done;
  } else if (action.type === "add-task") {
    const title = typeof action.title === "string" ? action.title.trim().slice(0, 120) : "";
    if (!title || next.tasks.length >= 30) return state;
    next.tasks.push({
      id: `t${next.nextTask++}`,
      title,
      source: "Tasks",
      due: "Today",
      done: false,
    });
  } else if (action.type === "add-suggestion") {
    const suggestion = next.suggestions.find((item) => item.id === action.id);
    if (!suggestion) return state;
    next.tasks.push({
      id: `suggested-${suggestion.id}`,
      title: suggestion.title,
      source: "Tasks",
      due: "Today",
      done: false,
    });
    next.suggestions = next.suggestions.filter((item) => item.id !== action.id);
  } else if (action.type === "mail-status") {
    const mail = next.mail.find((item) => item.id === action.id);
    if (!mail || !["inbox", "snoozed", "archived"].includes(action.status)) return state;
    mail.status = action.status;
  } else if (action.type === "note") {
    if (typeof action.value !== "string") return state;
    next.note = action.value.slice(0, 4000);
  } else {
    return state;
  }
  return next;
}
