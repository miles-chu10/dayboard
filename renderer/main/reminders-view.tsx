import { ScrollArea } from "@glaze/core/components";

import { SourceHeading } from "../components/source-dot";
import { SourceGate } from "../components/source-gate";
import { TodoGroups } from "../components/todo-row";
import { ViewActions } from "../components/view-actions";
import { useReminders } from "../lib/queries";
import { buildTodos } from "../lib/todos";

export function RemindersView() {
  const reminders = useReminders();
  const open =
    reminders.data?.state === "ok"
      ? reminders.data.items.filter((reminder) => !reminder.completed).length
      : null;

  return (
    <ScrollArea
      className="h-full"
      title={<SourceHeading source="reminders" />}
      subtitle={open === null ? undefined : `${open} open`}
      actions={
        <ViewActions onRefresh={() => void reminders.refetch()} refreshing={reminders.isFetching} />
      }
    >
      <div className="flex flex-col gap-6 px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
        <SourceGate query={reminders} label="Apple Reminders">
          {(items) => (
            <TodoGroups
              todos={buildTodos(undefined, { state: "ok", items })}
              emptyTitle="All Caught Up"
              emptyDescription="You have no open reminders."
            />
          )}
        </SourceGate>
      </div>
    </ScrollArea>
  );
}
