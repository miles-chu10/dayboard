import { ScrollArea } from "@glaze/core/components";

import { SourceGate } from "../components/source-gate";
import { TodoGroups } from "../components/todo-row";
import { ViewActions } from "../components/view-actions";
import { useTasks } from "../lib/queries";
import { buildTodos } from "../lib/todos";

export function TasksView() {
  const tasks = useTasks();
  const open = tasks.data?.state === "ok" ? tasks.data.items.filter((task) => !task.completed).length : null;

  return (
    <ScrollArea
      className="h-full"
      title="Google Tasks"
      subtitle={open === null ? undefined : `${open} open`}
      actions={<ViewActions onRefresh={() => void tasks.refetch()} refreshing={tasks.isFetching} />}
    >
      <div className="flex flex-col gap-6 px-6 pb-8 pt-2 w-full max-w-4xl mx-auto">
        <SourceGate query={tasks} label="Google Tasks">
          {(items) => (
            <TodoGroups
              todos={buildTodos({ state: "ok", items }, undefined)}
              emptyTitle="All Caught Up"
              emptyDescription="You have no open Google Tasks."
            />
          )}
        </SourceGate>
      </div>
    </ScrollArea>
  );
}
