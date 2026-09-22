import type { AgendaDuplicateLink, ReminderItem, SourceResult, TaskItem } from "@main/shared-types";

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
        key: `reminder:${reminder.ref}`,
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
  return (links ?? []).flatMap((link) =>
    link.status !== "accepted"
      ? []
      : link.leftKey === key
        ? [link.rightKey]
        : link.rightKey === key
          ? [link.leftKey]
          : [],
  );
}

function specificity(todo: Todo): number {
  return (todo.dueTime ? 2 : 0) + (todo.dueDate ? 1 : 0);
}

/**
 * Collapses each group of linked open items into one row. The item with the most specific
 * deadline stays (Google Tasks wins ties) and carries the others in `linked`.
 */
export function mergeLinkedTodos(todos: Todo[], links: AgendaDuplicateLink[] | undefined): Todo[] {
  if (!links?.some((link) => link.status === "accepted")) return todos;
  const open = new Map(todos.filter((todo) => !todo.completed).map((todo) => [todo.key, todo]));
  const hidden = new Set<string>();
  const partners = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (todo.completed || hidden.has(todo.key)) continue;
    const group = [todo];
    for (let index = 0; index < group.length; index++) {
      for (const key of linkedKeys(links, group[index].key)) {
        const other = open.get(key);
        if (other && !group.includes(other) && !hidden.has(key)) group.push(other);
      }
    }
    if (group.length < 2) continue;
    const [primary, ...rest] = [...group].sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        (a.source === b.source ? 0 : a.source === "tasks" ? -1 : 1) ||
        a.key.localeCompare(b.key),
    );
    partners.set(primary.key, rest);
    for (const other of rest) hidden.add(other.key);
  }
  return todos
    .filter((todo) => !hidden.has(todo.key))
    .map((todo) => (partners.has(todo.key) ? { ...todo, linked: partners.get(todo.key) } : todo));
}
