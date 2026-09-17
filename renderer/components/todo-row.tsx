import { Badge, Checkbox, EmptyState, Text } from "@glaze/core/components";

import { formatDue } from "../lib/dates";
import { useToggleTodo } from "../lib/queries";
import { compareByDue, type Todo } from "../lib/todos";
import { ListCard, SectionCard } from "./section-card";
import { SourceHeading, SourceLabel } from "./source-dot";

export function TodoRow({ todo, detail, showSource }: { todo: Todo; detail?: string; showSource?: boolean }) {
  const toggle = useToggleTodo();
  const due = todo.dueDate && !todo.completed ? formatDue(todo.dueDate, todo.dueTime) : null;
  const plainDetail = detail ?? todo.notes;

  return (
    <div className="flex items-center gap-3 px-3 py-2 min-h-12 min-w-0">
      <Checkbox
        checked={todo.completed}
        onCheckedChange={() => toggle.mutate(todo)}
        aria-label={todo.completed ? `Mark “${todo.title}” incomplete` : `Complete “${todo.title}”`}
      />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <Text truncate color={todo.completed ? "tertiary" : "primary"} className={todo.completed ? "line-through" : undefined}>
          {todo.title}
        </Text>
        {showSource ? (
          <SourceLabel source={todo.source} detail={detail ?? todo.listTitle} />
        ) : plainDetail ? (
          <Text variant="small" color="tertiary" truncate>
            {plainDetail}
          </Text>
        ) : null}
      </div>
      {due ? (
        <Badge color={due.color} className="shrink-0">
          {due.label}
        </Badge>
      ) : null}
    </div>
  );
}

export function TodoGroups({
  todos,
  emptyTitle,
  emptyDescription,
}: {
  todos: Todo[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!todos.length) {
    return <EmptyState placement="viewport" title={emptyTitle} description={emptyDescription} />;
  }

  const groups = new Map<string, Todo[]>();
  for (const todo of [...todos].sort(compareByDue)) {
    groups.set(todo.listTitle, [...(groups.get(todo.listTitle) ?? []), todo]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...groups].map(([listTitle, items]) => (
        <SectionCard
          key={listTitle}
          title={<SourceHeading source={items[0].source}>{listTitle}</SourceHeading>}
          accessory={
            <Text variant="small" color="tertiary" className="tabular-nums">
              {items.filter((item) => !item.completed).length}
            </Text>
          }
        >
          <ListCard>
            {items.map((todo) => (
              <TodoRow key={todo.key} todo={todo} />
            ))}
          </ListCard>
        </SectionCard>
      ))}
    </div>
  );
}
