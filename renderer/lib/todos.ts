import type { AgendaDuplicateLink, ReminderItem, SourceResult, TaskItem } from "@main/shared-types";
import { reminderAgendaKey } from "../../shared/agenda-identities";

export interface Todo {
  key: string;
  source: "tasks" | "reminders";
  title: string;
  notes: string | null;
  dueDate: string | null;
  dueTime: string | null;
  listTitle: string;
  completed: boolean;
  completedAt: string | null;
  task?: TaskItem;
  reminder?: ReminderItem;
  /** The full accepted connected component, including this item, when it is merged. */
  linkedKeys?: string[];
  /** Open items the user linked as the same to-do; shown on this row instead of separately. */
  linked?: Todo[];
}

export function buildTodos(
  tasks: SourceResult<TaskItem> | undefined,
  reminders: SourceResult<ReminderItem> | undefined,
): Todo[] {
  const todos: Todo[] = [];
  if (tasks?.state === "ok") {
    for (const task of tasks.items) {
      todos.push({
        key: `task:${task.listId}:${task.id}`,
        source: "tasks",
        title: task.title,
        notes: task.notes,
        dueDate: task.due,
        dueTime: null,
        listTitle: task.listTitle,
        completed: task.completed,
        completedAt: task.completedAt,
        task,
      });
    }
  }
  if (reminders?.state === "ok") {
    for (const reminder of reminders.items) {
      todos.push({
        key: reminderAgendaKey(reminder),
        source: "reminders",
        title: reminder.title,
        notes: reminder.notes,
        dueDate: reminder.dueDate,
        dueTime: reminder.dueTime,
        listTitle: reminder.listTitle,
        completed: reminder.completed,
        completedAt: reminder.completedAt,
        reminder,
      });
    }
  }
  return todos;
}

export function compareByDue(a: Todo, b: Todo): number {
  const aKey = a.dueDate ? `${a.dueDate}T${a.dueTime ?? "23:59"}` : "9999";
  const bKey = b.dueDate ? `${b.dueDate}T${b.dueTime ?? "23:59"}` : "9999";
  return aKey.localeCompare(bKey) || a.title.localeCompare(b.title);
}

/** Keys of items the user accepted as duplicates of `key`. */
export function linkedKeys(links: AgendaDuplicateLink[] | undefined, key: string): string[] {
  return linkedGroupKeys(links, key).filter((candidate) => candidate !== key);
}

/**
 * Accepted links are an undirected graph. Display and completion use the same
 * component so a chain such as A-B-C cannot merge differently than it writes.
 */
export function linkedGroupKeys(links: AgendaDuplicateLink[] | undefined, key: string): string[] {
  const adjacent = new Map<string, string[]>();
  for (const link of links ?? []) {
    if (link.status !== "accepted") continue;
    adjacent.set(link.leftKey, [...(adjacent.get(link.leftKey) ?? []), link.rightKey]);
    adjacent.set(link.rightKey, [...(adjacent.get(link.rightKey) ?? []), link.leftKey]);
  }
  const seen = new Set([key]);
  const queue = [key];
  for (let index = 0; index < queue.length; index++) {
    for (const next of adjacent.get(queue[index]) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return queue;
}

function specificity(todo: Todo): number {
  return (todo.dueTime ? 2 : 0) + (todo.dueDate ? 1 : 0);
}

/**
 * Collapses each group of linked open items into one row. The item with the most specific
 * deadline stays (Google Tasks wins ties) and carries the others in `linked`.
 */
export function mergeLinkedTodos(
  todos: Todo[],
  links: AgendaDuplicateLink[] | undefined,
  visibleSources?: Partial<Record<Todo["source"], boolean>>,
): Todo[] {
  const visible = todos.filter((todo) => visibleSources?.[todo.source] ?? true);
  if (!links?.some((link) => link.status === "accepted")) return visible;
  const open = new Map(visible.filter((todo) => !todo.completed).map((todo) => [todo.key, todo]));
  const hidden = new Set<string>();
  const partners = new Map<string, Todo[]>();
  const memberships = new Map<string, string[]>();
  for (const todo of visible) {
    if (todo.completed || hidden.has(todo.key)) continue;
    // Traverse stored graph keys before selecting displayable items. An
    // unavailable, completed, or source-filtered B still connects A-B-C.
    const membership = linkedGroupKeys(links, todo.key);
    const group = membership
      .map((key) => open.get(key))
      .filter((item): item is Todo => Boolean(item));
    memberships.set(todo.key, membership);
    if (group.length < 2) continue;
    const [primary, ...rest] = [...group].sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        (a.source === b.source ? 0 : a.source === "tasks" ? -1 : 1) ||
        a.key.localeCompare(b.key),
    );
    partners.set(primary.key, rest);
    memberships.set(primary.key, membership);
    for (const other of rest) hidden.add(other.key);
  }
  return visible
    .filter((todo) => !hidden.has(todo.key))
    .map((todo) =>
      partners.has(todo.key)
        ? {
            ...todo,
            linked: partners.get(todo.key),
            linkedKeys: memberships.get(todo.key) ?? [todo.key],
          }
        : memberships.has(todo.key)
          ? { ...todo, linkedKeys: memberships.get(todo.key) }
          : todo,
    );
}
