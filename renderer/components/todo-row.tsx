import { Checkbox, EmptyState, Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import type { ReactNode } from "react";

import { useToggleTodo } from "../lib/queries";
import { compareByDue, type Todo } from "../lib/todos";
import { DueChip } from "./agenda-chips";
import { ListCard, SectionCard } from "./section-card";
import { SourceHeading, SourceLabel } from "./source-dot";
import { ItemEditButton } from "./item-editor";

export function TodoRow({
  todo,
  detail,
  showSource,
  onOpen,
  selected,
  expanded,
}: {
  todo: Todo;
  detail?: string;
  showSource?: boolean;
  onOpen?: (todo: Todo) => void;
  selected?: boolean;
  expanded?: ReactNode;
}) {
  const toggle = useToggleTodo();
  const plainDetail = detail ?? todo.notes;

  return (
    <div>
      <div
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-expanded={onOpen ? Boolean(selected) : undefined}
        aria-label={onOpen ? `Open ${todo.title}` : undefined}
        onClick={onOpen ? () => onOpen(todo) : undefined}
        onKeyDown={
          onOpen
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(todo);
                }
              }
            : undefined
        }
        className={cn(
          "flex items-center gap-3 px-3 py-[var(--density-row-py)] min-h-[var(--density-list-row)] min-w-0",
          onOpen &&
            "cursor-default hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
          selected && "bg-list-selection",
        )}
      >
        <Checkbox
          className="rounded-full"
          checked={todo.completed}
          onCheckedChange={() => toggle.mutate(todo)}
          onClick={(event) => event.stopPropagation()}
          aria-label={
            todo.completed ? `Mark “${todo.title}” incomplete` : `Complete “${todo.title}”`
          }
        />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <Text
            truncate
            color={todo.completed ? "tertiary" : "primary"}
            className={todo.completed ? "line-through" : undefined}
          >
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
        {todo.dueDate && !todo.completed ? (
          <DueChip date={todo.dueDate} time={todo.dueTime} />
        ) : null}
        <span
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ItemEditButton item={todo} />
        </span>
      </div>
      {expanded ? <div className="px-3 pb-3">{expanded}</div> : null}
    </div>
  );
}

export function TodoGroups({
  todos,
  emptyTitle,
  emptyDescription,
  selectedKey,
  onOpen,
  renderExpanded,
}: {
  todos: Todo[];
  emptyTitle: string;
  emptyDescription: string;
  selectedKey?: string;
  onOpen?: (todo: Todo) => void;
  renderExpanded?: (todo: Todo) => ReactNode;
}) {
  if (!todos.length) {
    return <EmptyState placement="viewport" title={emptyTitle} description={emptyDescription} />;
  }

  const groups = new Map<string, Todo[]>();
  for (const todo of [...todos].sort(compareByDue)) {
    groups.set(todo.listTitle, [...(groups.get(todo.listTitle) ?? []), todo]);
  }

  return (
    <div className="flex flex-col gap-[var(--density-section-gap)]">
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
              <TodoRow
                key={todo.key}
                todo={todo}
                onOpen={onOpen}
                selected={selectedKey === todo.key}
                expanded={
                  selectedKey === todo.key && renderExpanded ? renderExpanded(todo) : undefined
                }
              />
            ))}
          </ListCard>
        </SectionCard>
      ))}
    </div>
  );
}
