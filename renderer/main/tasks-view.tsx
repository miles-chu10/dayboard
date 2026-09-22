import { useState } from "react";
import { ScrollArea } from "@glaze/core/components";

import { AgendaDetailDialog } from "../components/agenda-detail-dialog";
import { SourceHeading } from "../components/source-dot";
import { SourceGate } from "../components/source-gate";
import { TodoGroups } from "../components/todo-row";
import { HistoryNav } from "../components/history-nav";
import { ViewActions } from "../components/view-actions";
import { todayISO } from "../lib/dates";
import { useMail, useTasks } from "../lib/queries";
import { useSettings } from "../lib/settings";
import { buildTodos, type Todo } from "../lib/todos";

export function TasksView() {
  const tasks = useTasks();
  const mail = useMail();
  const settings = useSettings().data;
  const detailView = settings?.general.detailView ?? "dialog";
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const todos =
    tasks.data?.state === "ok"
      ? buildTodos({ state: "ok", items: tasks.data.items }, undefined)
      : [];
  const open = todos.filter((todo) => !todo.completed).length;
  const selected = todos.find((todo) => todo.key === selectedKey);
  const messages = mail.data?.state === "ok" ? mail.data.items : [];
  const today = todayISO();

  function toggleOpen(todo: Todo) {
    setSelectedKey((current) => (current === todo.key ? undefined : todo.key));
  }

  function renderDetail(presentation: "dialog" | "panel") {
    if (!selected) return null;
    return (
      <AgendaDetailDialog
        key={selected.key}
        todo={selected}
        todos={todos}
        events={[]}
        messages={messages}
        date={selected.dueDate && selected.dueDate >= today ? selected.dueDate : today}
        now={new Date()}
        presentation={presentation}
        onClose={() => setSelectedKey(undefined)}
      />
    );
  }

  const sidePanel = detailView === "sidebar" ? renderDetail("panel") : null;

  return (
    <>
      <div className="flex h-full min-w-0">
        <div className="h-full min-w-0 flex-1">
          <ScrollArea
            className="h-full"
            leading={<HistoryNav />}
            title={<SourceHeading source="tasks" />}
            subtitle={tasks.data?.state === "ok" ? `${open} open` : undefined}
            actions={
              <ViewActions onRefresh={() => void tasks.refetch()} refreshing={tasks.isFetching} />
            }
          >
            <div className="flex flex-col gap-[var(--density-section-gap)] px-6 pb-8 pt-1 w-full max-w-4xl mx-auto">
              <SourceGate query={tasks} label="Google Tasks">
                {(items) => (
                  <TodoGroups
                    todos={buildTodos({ state: "ok", items }, undefined)}
                    emptyTitle="All Caught Up"
                    emptyDescription="You have no open Google Tasks."
                    selectedKey={selectedKey}
                    onOpen={toggleOpen}
                    renderExpanded={
                      detailView === "inline" ? () => renderDetail("panel") : undefined
                    }
                  />
                )}
              </SourceGate>
            </div>
          </ScrollArea>
        </div>
        {sidePanel ? (
          <aside
            aria-label="Task details"
            className="h-full w-[min(380px,40%)] shrink-0 overflow-y-auto border-l border-separator px-3 pb-6 pt-14"
          >
            {sidePanel}
          </aside>
        ) : null}
      </div>
      {detailView === "dialog" ? renderDetail("dialog") : null}
    </>
  );
}
