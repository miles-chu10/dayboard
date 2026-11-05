import { createDemoState, demoMeetings, reduceDemo } from "./demo-state.js";

const root = document.querySelector("[data-demo]");
if (root) startDemo(root);

function startDemo(root) {
  let state = createDemoState();
  let previous = null;
  let view = "Home";
  let span = "today";
  let folder = "inbox";
  let selectedMail = null;
  let selectedEvent = null;
  let noteMode = "write";
  let assistantOpen = false;
  let renderedView = null;

  const icons = {
    Home: "M3 10 12 3l9 7v10H3V10ZM9 20v-7h6v7",
    Inbox: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
    Calendar: "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4",
    Tasks: "m4 6 2 2 4-4m2 3h8M4 14h5v5H4v-5Zm8 2h8",
    Notes: "M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8m-8 4h6",
    Ask: "M4 4h16v12H9l-5 4V4Zm4 4h8m-8 4h5",
    Reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
    Close: "m6 6 12 12M18 6 6 18",
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.6",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    }))
      svg.setAttribute(key, value);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", icons[name]);
    svg.append(path);
    return svg;
  }

  function button(label, onClick, className = "demo-button", iconName) {
    const node = el("button", className);
    node.type = "button";
    if (iconName) node.append(icon(iconName));
    node.append(el("span", "", label));
    node.addEventListener("click", onClick);
    return node;
  }

  function focusKey(key) {
    [...root.querySelectorAll("[data-key]")].find((node) => node.dataset.key === key)?.focus();
  }

  const top = el("div", "demo-topbar");
  const dots = el("span", "demo-window-dots");
  dots.setAttribute("aria-hidden", "true");
  dots.append(el("i"), el("i"), el("i"));
  top.append(
    dots,
    el("strong", "demo-brand", "DayBoard"),
    el("span", "demo-badge", "Interactive demo"),
  );
  const reset = button(
    "Reset",
    () => {
      state = createDemoState();
      previous = null;
      selectedMail = null;
      selectedEvent = null;
      folder = "inbox";
      span = "today";
      noteMode = "write";
      renderedView = null;
      setAssistant(false, false);
      view = "Home";
      render();
      announce("The sample day has been reset.");
      reset.focus();
    },
    "demo-reset",
    "Reset",
  );
  reset.setAttribute("aria-label", "Reset demo");
  top.append(reset);

  const layout = el("div", "demo-layout");
  const nav = el("nav", "demo-navigation");
  nav.setAttribute("aria-label", "Demo views");
  const viewButtons = new Map();
  for (const name of ["Home", "Inbox", "Calendar", "Tasks", "Notes"]) {
    const node = button(
      name,
      () => {
        view = name;
        selectedMail = null;
        selectedEvent = null;
        setAssistant(false, false);
        render();
        content.focus({ preventScroll: true });
      },
      "demo-nav-button",
      name,
    );
    viewButtons.set(name, node);
    nav.append(node);
  }
  nav.append(
    el("div", "demo-profile", "Alex Rivera"),
    el("span", "demo-profile-note", "Fictional sample account"),
  );

  const workspace = el("div", "demo-workspace");
  const toolbar = el("div", "demo-toolbar");
  const viewTitle = el("strong", "", "Home");
  const ask = button("Ask", () => setAssistant(!assistantOpen), "demo-button", "Ask");
  ask.setAttribute("aria-label", "Open sample Assistant");
  ask.setAttribute("aria-expanded", "false");
  ask.setAttribute("aria-controls", "demo-assistant");
  toolbar.append(viewTitle, ask);
  const content = el("div", "demo-content");
  content.tabIndex = -1;
  const assistant = el("aside", "demo-assistant");
  assistant.id = "demo-assistant";
  assistant.setAttribute("aria-label", "Sample Assistant");
  assistant.hidden = true;
  workspace.append(toolbar, content, assistant);
  layout.append(nav, workspace);
  const feedback = el("div", "demo-feedback");
  const message = el("p", "", "Fictional data. Changes stay in this tab.");
  message.setAttribute("role", "status");
  const undo = button(
    "Undo",
    () => {
      if (!previous) return;
      state = previous;
      previous = null;
      render();
      announce("Last change undone.");
      content.focus({ preventScroll: true });
    },
    "demo-text-button",
  );
  undo.hidden = true;
  feedback.append(message, undo);
  root.append(top, layout, feedback);

  function announce(text) {
    message.textContent = text;
    undo.hidden = !previous;
  }

  function change(action, text, key) {
    previous = state;
    state = reduceDemo(state, action);
    render();
    announce(text);
    if (key) focusKey(key);
  }

  function segment(items, selected, callback, label) {
    const group = el("div", "demo-segments");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    for (const [value, title] of items) {
      const node = button(title, () => callback(value), "demo-segment");
      node.setAttribute("aria-pressed", String(value === selected));
      node.dataset.key = `segment-${value}`;
      group.append(node);
    }
    return group;
  }

  function panel(title, children, count) {
    const section = el("section", "demo-panel");
    const heading = el("div", "demo-panel-heading");
    heading.append(el("h4", "", title));
    if (count !== undefined) heading.append(el("span", "demo-count", String(count)));
    section.append(heading, ...children);
    return section;
  }

  function taskRows() {
    return state.tasks.map((task) => {
      const row = el("label", `demo-task${task.done ? " is-done" : ""}`);
      const checkbox = el("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.dataset.key = task.id;
      checkbox.setAttribute("aria-label", task.title);
      checkbox.addEventListener("change", () =>
        change(
          { type: "toggle-task", id: task.id },
          task.done ? "Task reopened in the demo." : "Task completed in the demo.",
          task.id,
        ),
      );
      const text = el("span", "demo-task-text");
      text.append(
        el("span", "demo-task-title", task.title),
        el("small", "", `${task.source} · ${task.due}`),
      );
      row.append(checkbox, text);
      return row;
    });
  }

  function meetingRows() {
    return demoMeetings
      .filter((meeting) => span === "week" || meeting.day === "Today")
      .map((meeting) => {
        const row = button(
          "",
          () => {
            view = "Calendar";
            selectedEvent = meeting.id;
            render();
            content.focus({ preventScroll: true });
          },
          `demo-meeting is-${meeting.color}`,
        );
        row.replaceChildren(
          el("strong", "", meeting.title),
          el("span", "", `${meeting.day} · ${meeting.time}`),
        );
        return row;
      });
  }

  function renderHome() {
    const waiting = state.mail.filter(
      (mail) => mail.status === "inbox" && mail.triage === "Needs reply",
    );
    const head = el("div", "demo-view-heading");
    const intro = el("div");
    intro.append(
      el("h3", "", "Good morning, Alex"),
      el(
        "p",
        "demo-muted",
        `${waiting.length} waiting on you · ${state.tasks.filter((task) => !task.done).length} tasks to do`,
      ),
    );
    head.append(
      intro,
      segment(
        [
          ["today", "Today"],
          ["week", "This week"],
        ],
        span,
        (value) => {
          span = value;
          render();
          focusKey(`segment-${value}`);
        },
        "Home time range",
      ),
    );
    const columns = el("div", "demo-home-columns");
    const primary = el("div", "demo-home-primary");
    const mailRows = waiting.map((mail) => {
      const row = button(
        "",
        () => {
          view = "Inbox";
          selectedMail = mail.id;
          render();
          content.focus({ preventScroll: true });
        },
        "demo-needs-row",
      );
      row.replaceChildren(
        icon("Inbox"),
        el("strong", "", mail.from),
        el("span", "", mail.subject),
        el("small", "demo-chip", "Needs reply"),
      );
      return row;
    });
    if (!mailRows.length)
      mailRows.push(el("p", "demo-empty", "All caught up. Nothing needs you right now."));
    const suggestions = state.suggestions.map((item) => {
      const row = el("div", "demo-suggestion");
      const text = el("div");
      text.append(el("strong", "", item.title), el("small", "", item.from));
      const add = button("Add", () =>
        change(
          { type: "add-suggestion", id: item.id },
          `${item.title} added to your sample tasks.`,
          "home-tasks",
        ),
      );
      add.setAttribute("aria-label", `Add suggested task: ${item.title}`);
      row.append(text, add);
      return row;
    });
    if (!suggestions.length)
      suggestions.push(el("p", "demo-empty", "You're up to date with the sample suggestions."));
    const tasks = panel("Your tasks", taskRows(), state.tasks.filter((task) => !task.done).length);
    tasks.tabIndex = -1;
    tasks.dataset.key = "home-tasks";
    primary.append(
      panel("Needs you", mailRows, waiting.length),
      panel("Suggested", suggestions),
      tasks,
    );
    columns.append(primary, panel("Meetings", meetingRows()));
    content.append(head, columns);
  }

  function renderTasks() {
    content.append(
      el("h3", "", "Your tasks"),
      el("p", "demo-muted", "Work and personal to-dos, together."),
    );
    const form = el("form", "demo-add-task");
    const input = el("input");
    input.type = "text";
    input.maxLength = 120;
    input.required = true;
    input.placeholder = "Add a sample task…";
    input.setAttribute("aria-label", "New sample task");
    const add = button("Add task", () => {});
    add.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input.value.trim()) {
        input.setCustomValidity("Enter a task title.");
        input.reportValidity();
        return;
      }
      if (state.tasks.length >= 30) {
        announce("The sample holds up to 30 tasks. Reset to start again.");
        return;
      }
      const key = `t${state.nextTask}`;
      change({ type: "add-task", title: input.value }, "Task added to the sample day.", key);
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    form.append(input, add);
    content.append(
      form,
      panel("Tasks & Reminders", taskRows(), state.tasks.filter((task) => !task.done).length),
    );
  }

  function renderMail() {
    const heading = el("div", "demo-view-heading");
    heading.append(
      el("h3", "", "Inbox"),
      segment(
        [
          ["inbox", "Inbox"],
          ["snoozed", "Later"],
        ],
        folder,
        (value) => {
          folder = value;
          selectedMail = null;
          render();
          focusKey(`segment-${value}`);
        },
        "Mail folder",
      ),
    );
    const columns = el("div", `demo-mail-columns${selectedMail ? " has-message" : ""}`);
    const list = el("div", "demo-mail-list");
    const messages = state.mail.filter((mail) => mail.status === folder);
    for (const mail of messages) {
      const row = button(
        "",
        () => {
          selectedMail = mail.id;
          render();
          focusKey("message-heading");
        },
        "demo-mail-row",
      );
      row.setAttribute("aria-label", `${mail.from}: ${mail.subject}`);
      row.setAttribute("aria-pressed", String(mail.id === selectedMail));
      row.replaceChildren(el("span", "demo-avatar", mail.initials));
      const text = el("span");
      text.append(
        el("strong", "", mail.from),
        el("span", "", mail.subject),
        el(
          "small",
          "",
          folder === "snoozed" ? "Snoozed until tomorrow" : `${mail.time} · ${mail.triage}`,
        ),
      );
      row.append(text);
      list.append(row);
    }
    if (!messages.length)
      list.append(
        el(
          "p",
          "demo-empty",
          folder === "inbox"
            ? "Inbox clear. Your snoozed messages are in Later."
            : "No snoozed messages yet.",
        ),
      );
    const detail = el("div", "demo-mail-detail");
    const mail = messages.find((item) => item.id === selectedMail);
    if (mail) {
      detail.append(
        button(
          "← Back to messages",
          () => {
            selectedMail = null;
            render();
            content.focus({ preventScroll: true });
          },
          "demo-text-button",
        ),
      );
      const title = el("h4", "", mail.subject);
      title.tabIndex = -1;
      title.dataset.key = "message-heading";
      detail.append(
        title,
        el("p", "demo-muted", `${mail.from} → Alex Rivera`),
        el("p", "demo-mail-body", mail.body),
      );
      const actions = el("div", "demo-mail-actions");
      const move = (status, text) => {
        selectedMail = null;
        change({ type: "mail-status", id: mail.id, status }, text);
        content.focus({ preventScroll: true });
      };
      actions.append(button("Archive", () => move("archived", "Message archived in the demo.")));
      actions.append(
        folder === "inbox"
          ? button("Snooze until tomorrow", () =>
              move("snoozed", "Message moved to Later in the demo."),
            )
          : button("Return to Inbox", () => move("inbox", "Message returned to the sample inbox.")),
      );
      detail.append(actions);
    } else {
      detail.append(
        icon("Inbox"),
        el("p", "demo-muted", "Select a message to read it, archive it or try snoozing."),
      );
    }
    columns.append(list, detail);
    content.append(heading, columns);
  }

  function renderCalendar() {
    const heading = el("div", "demo-view-heading");
    heading.append(
      el("h3", "", "Calendar"),
      segment(
        [
          ["today", "Today"],
          ["week", "This week"],
        ],
        span,
        (value) => {
          span = value;
          render();
          focusKey(`segment-${value}`);
        },
        "Calendar time range",
      ),
    );
    content.append(heading, el("p", "demo-muted", "Schedule · A fictional Wednesday in November"));
    const schedule = el("div", "demo-schedule");
    for (const meeting of demoMeetings.filter((item) => span === "week" || item.day === "Today")) {
      const row = button(
        "",
        () => {
          selectedEvent = selectedEvent === meeting.id ? null : meeting.id;
          render();
          focusKey(meeting.id);
        },
        `demo-event is-${meeting.color}`,
      );
      row.dataset.key = meeting.id;
      row.setAttribute("aria-expanded", String(selectedEvent === meeting.id));
      row.replaceChildren(el("time", "", `${meeting.day}\n${meeting.time}`));
      const text = el("span");
      text.append(
        el("strong", "", meeting.title),
        el("small", "", `${meeting.time} – ${meeting.end}`),
      );
      if (selectedEvent === meeting.id)
        text.append(el("span", "demo-event-detail", meeting.detail));
      row.append(text);
      schedule.append(row);
    }
    content.append(schedule);
  }

  function previewNote(value, target) {
    target.replaceChildren();
    if (!value.trim()) {
      target.append(el("p", "demo-muted", "Your note preview will appear here."));
      return;
    }
    for (const line of value.split("\n")) {
      if (!line.trim()) continue;
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      const node = heading
        ? el(heading[1].length === 1 ? "h4" : "h5", "", heading[2])
        : el(
            "p",
            line.startsWith("- ") ? "demo-note-bullet" : "",
            line.startsWith("- ") ? `• ${line.slice(2)}` : line,
          );
      target.append(node);
    }
  }

  function renderNotes() {
    const heading = el("div", "demo-view-heading");
    heading.append(
      el("h3", "", "Launch checklist"),
      segment(
        [
          ["write", "Write"],
          ["preview", "Preview"],
        ],
        noteMode,
        (value) => {
          noteMode = value;
          render();
          focusKey(`segment-${value}`);
        },
        "Note mode",
      ),
    );
    const area = el("div", "demo-notes");
    area.dataset.mode = noteMode;
    const editor = el("textarea", "demo-note-editor");
    editor.setAttribute("aria-label", "Sample note in Markdown");
    editor.maxLength = 4000;
    editor.value = state.note;
    editor.spellcheck = false;
    const preview = el("div", "demo-note-preview");
    preview.setAttribute("aria-label", "Note preview");
    previewNote(state.note, preview);
    editor.addEventListener("input", () => {
      state = reduceDemo(state, { type: "note", value: editor.value });
      previous = null;
      undo.hidden = true;
      previewNote(state.note, preview);
    });
    editor.addEventListener("change", () => announce("Sample note saved in this tab."));
    area.append(editor, preview);
    content.append(
      heading,
      el("p", "demo-muted", "Markdown note · Saved only in this demo tab"),
      area,
    );
  }

  function setAssistant(open, restoreFocus = true) {
    assistantOpen = open;
    assistant.hidden = !open;
    workspace.dataset.assistant = open ? "open" : "closed";
    ask.setAttribute("aria-expanded", String(open));
    ask.setAttribute("aria-label", open ? "Close sample Assistant" : "Open sample Assistant");
    if (!open) {
      if (restoreFocus) ask.focus();
      return;
    }
    assistant.replaceChildren();
    const heading = el("div", "demo-view-heading");
    const close = button("Close", () => setAssistant(false), "demo-icon-button", "Close");
    close.setAttribute("aria-label", "Close sample Assistant");
    heading.append(el("h4", "", "Sample Assistant"), close);
    assistant.append(
      heading,
      el("p", "demo-muted", "Example responses for this sample day. No live AI requests."),
    );
    const answer = el("div", "demo-answer");
    answer.setAttribute("role", "status");
    const prompts = el("div", "demo-prompts");
    for (const label of [
      "What needs my attention?",
      "Help me reply to Priya",
      "Plan a focus block",
    ]) {
      prompts.append(
        button(
          label,
          () => {
            let response;
            if (label === "What needs my attention?") {
              const waiting = state.mail.filter(
                (mail) => mail.status === "inbox" && mail.triage === "Needs reply",
              ).length;
              const unfinished = state.tasks.filter((task) => !task.done).length;
              response = `You have ${waiting} ${waiting === 1 ? "message" : "messages"} waiting on you and ${unfinished} unfinished ${unfinished === 1 ? "task" : "tasks"}. Start with the launch copy before the 3 PM roadmap sync.`;
            } else if (label === "Help me reply to Priya")
              response =
                "Thanks, Priya — I’ll review the headline before the roadmap sync and send my notes. The draft is a useful starting point.";
            else
              response =
                "Set aside 30 minutes after standup for the launch announcement. Keep the afternoon clear for the Q4 roadmap sync.";
            answer.replaceChildren(
              el("span", "demo-answer-label", "Example response"),
              el("p", "", response),
            );
          },
          "demo-prompt",
        ),
      );
    }
    assistant.append(prompts, answer);
    close.focus();
  }

  function render() {
    const scroll = renderedView === view ? content.scrollTop : 0;
    content.replaceChildren();
    content.setAttribute("aria-label", `${view} demo`);
    viewTitle.textContent = view;
    for (const [name, node] of viewButtons) {
      if (name === view) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    }
    ({
      Home: renderHome,
      Tasks: renderTasks,
      Inbox: renderMail,
      Calendar: renderCalendar,
      Notes: renderNotes,
    })[view]();
    content.scrollTop = scroll;
    renderedView = view;
    undo.hidden = !previous;
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && assistantOpen) {
      event.preventDefault();
      setAssistant(false);
    }
  });
  render();
  root.hidden = false;
  const original = document.querySelector("[data-demo-static]");
  if (original) original.open = false;
}
