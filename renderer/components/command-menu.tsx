import { Command, defaultFilter } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, KeyCaps, Text, useSplitView } from "@renderer/ui";
import {
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  Keyboard,
  Mail,
  MessageCircle,
  PanelLeft,
  Plus,
  Search,
  Settings,
} from "lucide-react";

import { mentionCandidates, MENTION_EVENT_DAYS, type MentionItem } from "../lib/assistant-mentions";
import { todayISO } from "../lib/dates";
import { openSettings } from "../lib/ipc";
import { visibleNav } from "../lib/navigation";
import { useCalendarRange, useMail, useReminders, useTasks } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { SHORTCUTS, shortcutKeys } from "../lib/shortcuts";
import { buildTodos } from "../lib/todos";
import { useOpenCapture } from "./capture-dialog";
import { useOpenItem } from "./open-item";
import { useShell } from "./shell";

const MAX_ITEMS = 200;
const ASK_VALUE = "ask-row:";

/** cmdk's ranking, except the always-shown "Ask" row ranks last so Enter opens the best match. */
function commandFilter(value: string, search: string, keywords?: string[]): number {
  return value.startsWith(ASK_VALUE) ? Number.MIN_VALUE : defaultFilter(value, search, keywords);
}

const ITEM_ICON: Record<MentionItem["kind"], ReactNode> = {
  event: <CalendarDays />,
  task: <CheckSquare />,
  reminder: <CheckSquare />,
  email: <Mail />,
};

const itemClass =
  "flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-regular text-primary outline-none " +
  "data-[selected=true]:bg-list-hover [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-secondary";
const groupClass =
  "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 " +
  "[&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:text-secondary";

/** ⌘K: jump to any view or item, run an action, or hand the query to the Assistant. */
export function CommandMenu() {
  const { commandMenuOpen, setCommandMenuOpen } = useShell();
  return (
    <Dialog open={commandMenuOpen} onOpenChange={setCommandMenuOpen}>
      {commandMenuOpen ? <CommandMenuContent close={() => setCommandMenuOpen(false)} /> : null}
    </Dialog>
  );
}

function CommandMenuContent({ close }: { close: () => void }) {
  const shell = useShell();
  const navigate = useNavigate();
  const settings = useSettings().data;
  const openCapture = useOpenCapture();
  const { openMail, openEvent, openTodo } = useOpenItem();
  const { toggleSidebar } = useSplitView();
  const [query, setQuery] = useState("");
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const events = useCalendarRange(todayISO(), MENTION_EVENT_DAYS);
  const assistantOn = featureOn(settings, "assistant");
  const trimmed = query.trim();
  const items =
    trimmed.length >= 2
      ? mentionCandidates({
          calendar: sourceOn(settings, "calendar") ? events.data : undefined,
          todos: buildTodos(tasks.data, reminders.data),
          mail: mail.data,
        }).slice(0, MAX_ITEMS)
      : [];

  function run(action: () => void) {
    close();
    action();
  }
  function ask() {
    if (!assistantOn || !trimmed) return;
    run(() => shell.askAgent(trimmed));
  }
  function openFound(item: MentionItem) {
    run(() => {
      if (item.mail) openMail(item.mail.id);
      else if (item.event) openEvent(item.event);
      else if (item.todo) openTodo(item.todo);
    });
  }

  return (
    <DialogContent size="xl" className="top-[16%] translate-y-0 overflow-hidden p-0">
      <DialogTitle className="sr-only">Command menu</DialogTitle>
      <Command
        label="Command menu"
        loop
        filter={commandFilter}
        className="flex min-h-0 flex-col"
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey && trimmed && assistantOn) {
            event.preventDefault();
            ask();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-separator px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-secondary" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              assistantOn
                ? "Search, jump anywhere, or ask the Assistant…"
                : "Search or jump anywhere…"
            }
            className="h-12 min-w-0 flex-1 bg-transparent text-large text-primary outline-none placeholder:text-tertiary"
          />
          {assistantOn ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <Text variant="small" color="secondary">
                Ask Assistant
              </Text>
              <KeyCaps keys={["Tab"]} />
            </span>
          ) : null}
        </div>
        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain py-1">
          <Command.Empty className="px-4 py-6 text-center text-regular text-secondary">
            {assistantOn ? "No matches. Press Tab to ask the Assistant." : "No matches."}
          </Command.Empty>
          <Command.Group heading="Go to" className={groupClass}>
            {visibleNav(settings).map((item, index) => (
              <Command.Item
                key={item.id}
                value={`go ${item.title}`}
                keywords={item.keywords}
                onSelect={() => run(() => void navigate({ to: item.route }))}
                className={itemClass}
              >
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {index < 9 ? <KeyCaps keys={["⌃", String(index + 1)]} /> : null}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Actions" className={groupClass}>
            <Action
              label="New item"
              icon={<Plus />}
              keys={["⌘", "N"]}
              onSelect={() => run(openCapture)}
            />
            {assistantOn ? (
              <Action
                label="Ask the Assistant beside this page"
                icon={<MessageCircle />}
                keys={shortcutKeys(SHORTCUTS.askAgent)}
                onSelect={() => run(() => shell.setRightPane("agent"))}
              />
            ) : null}
            {sourceOn(settings, "calendar") ? (
              <Action
                label="Calendar beside this page"
                icon={<CalendarPlus />}
                keys={shortcutKeys(SHORTCUTS.calendarPeek)}
                onSelect={() => run(() => shell.setRightPane("calendar"))}
              />
            ) : null}
            <Action
              label="Show or hide the sidebar"
              icon={<PanelLeft />}
              keys={["⌃", "⌘", "S"]}
              onSelect={() => run(toggleSidebar)}
            />
            <Action
              label="Keyboard shortcuts"
              icon={<Keyboard />}
              keys={["?"]}
              onSelect={() => run(() => shell.setShortcutsOpen(true))}
            />
            <Action
              label="Settings"
              icon={<Settings />}
              keys={["⌘", ","]}
              onSelect={() => run(() => void openSettings())}
            />
          </Command.Group>
          {items.length ? (
            <Command.Group heading="Items" className={groupClass}>
              {items.map((item) => (
                <Command.Item
                  key={item.key}
                  value={`${item.kind} ${item.label} ${item.key}`}
                  keywords={[item.detail]}
                  onSelect={() => openFound(item)}
                  className={itemClass}
                >
                  {ITEM_ICON[item.kind]}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <Text variant="small" color="secondary" className="max-w-[40%] truncate">
                    {item.detail}
                  </Text>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {assistantOn && trimmed ? (
            <Command.Group heading="Assistant" className={groupClass} forceMount>
              <Command.Item
                value={`${ASK_VALUE}${trimmed}`}
                forceMount
                onSelect={ask}
                className={itemClass}
              >
                <MessageCircle />
                <span className="min-w-0 flex-1 truncate">Ask “{trimmed}”</span>
                <KeyCaps keys={["Tab"]} />
              </Command.Item>
            </Command.Group>
          ) : null}
        </Command.List>
        <div className="flex items-center gap-4 border-t border-separator px-3 py-2">
          <Hint keys={["↑", "↓"]} label="Move" />
          <Hint keys={["↩"]} label="Open" />
          <Hint keys={["Esc"]} label="Close" />
        </div>
      </Command>
    </DialogContent>
  );
}

function Action({
  label,
  icon,
  keys,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  keys: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item value={`action ${label}`} onSelect={onSelect} className={itemClass}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <KeyCaps keys={keys} />
    </Command.Item>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <KeyCaps keys={keys} />
      <Text variant="small" color="secondary">
        {label}
      </Text>
    </span>
  );
}
