import type { ReminderItem, SourceResult, TaskItem } from "@main/shared-types";

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
