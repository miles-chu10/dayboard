import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Field,
  FieldGroup,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  Textarea,
  toast,
} from "@renderer/ui";
import { Pencil } from "lucide-react";
import type { CalendarEventItem, ReminderItem, SourceResult, TaskItem } from "@main/shared-types";

import { isRendererDemoMode } from "../lib/demo";
import {
  changedCalendarDescription,
  eventTimesChanged,
  dateTimeInputToIso,
  eventEditorFields,
  itemEditorCanSave,
  nextCalendarDate,
  reminderDueChanged,
  type ItemEditorFields,
} from "../lib/item-editor-form";
import { errorMessage, invoke } from "../lib/ipc";
import { queryKeys } from "../lib/queries";
import type { Todo } from "../lib/todos";

type EditableItem = Todo | CalendarEventItem;
type ItemKind = "task" | "reminder" | "event";

function kindFor(item: EditableItem): ItemKind {
  if (isCalendarEvent(item)) return "event";
  return item.source === "tasks" ? "task" : "reminder";
}

function isCalendarEvent(item: EditableItem): item is CalendarEventItem {
  return "calendarId" in item;
}

function sourceLabel(kind: ItemKind): string {
  return kind === "task"
    ? "Google Tasks"
    : kind === "reminder"
      ? "Apple Reminders"
      : "Google Calendar";
}

function initialFields(item: EditableItem): ItemEditorFields {
  const kind = kindFor(item);
  if (isCalendarEvent(item)) return eventEditorFields(item);
  const todo = item as Todo;
  return {
    title: todo.title,
    notes: todo.notes ?? "",
    dueDate: todo.dueDate ?? "",
    dueTime: kind === "reminder" ? (todo.dueTime ?? "") : "",
    priority: kind === "reminder" ? String(todo.reminder?.priority ?? 0) : "0",
    allDay: false,
    start: "",
    end: "",
    location: "",
  };
}

function sourceKey(kind: ItemKind) {
  return kind === "task"
    ? queryKeys.tasks
    : kind === "reminder"
      ? queryKeys.reminders
      : queryKeys.calendar;
}

function replaceSourceItem(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: ItemKind,
  original: EditableItem,
  updated: TaskItem | ReminderItem | CalendarEventItem,
) {
  if (kind === "task") {
    const task = updated as TaskItem;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.id === (original as Todo).task?.id && item.listId === task.listId ? task : item,
            ),
          }
        : previous,
    );
  } else if (kind === "reminder") {
    const reminder = updated as ReminderItem;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.ref === (original as Todo).reminder?.ref ? reminder : item,
            ),
          }
        : previous,
    );
  } else {
    const event = updated as CalendarEventItem;
    queryClient.setQueryData<SourceResult<CalendarEventItem>>(queryKeys.calendar, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.id === (original as CalendarEventItem).id && item.calendarId === event.calendarId
                ? event
                : item,
            ),
          }
        : previous,
    );
  }
}

function removeSourceItem(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: ItemKind,
  item: EditableItem,
) {
  if (kind === "task") {
    const task = (item as Todo).task!;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter(
              (candidate) => candidate.id !== task.id || candidate.listId !== task.listId,
            ),
          }
        : previous,
    );
  } else if (kind === "reminder") {
    const reminder = (item as Todo).reminder!;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter((candidate) => candidate.ref !== reminder.ref),
          }
        : previous,
    );
  } else {
    const event = item as CalendarEventItem;
    queryClient.setQueryData<SourceResult<CalendarEventItem>>(queryKeys.calendar, (previous) =>
      previous?.state === "ok"
        ? {
            ...previous,
            items: previous.items.filter(
              (candidate) => candidate.id !== event.id || candidate.calendarId !== event.calendarId,
            ),
          }
        : previous,
    );
  }
}

export function ItemEditButton({
  item,
  onSaved,
  variant = "transparent",
}: {
  item: EditableItem;
  /** Called only after the provider confirms an edit or deletion. */
  onSaved?: () => void;
  variant?: "filled" | "transparent";
}) {
  const [open, setOpen] = useState(false);
  if (!isCalendarEvent(item) && item.reminder?.recurring) {
    return (
      <Button
        size="small"
        variant={variant}
        disabled
        title="Edit or delete recurring reminders in Apple Reminders."
      >
        <Pencil />
        Edit
      </Button>
    );
  }
  return (
    <>
      <Button size="small" variant={variant} onClick={() => setOpen(true)}>
        <Pencil />
        Edit
      </Button>
      {open ? (
        <ItemEditor
          item={item}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onSaved?.();
          }}
        />
      ) : null}
    </>
  );
}

function ItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: EditableItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const kind = kindFor(item);
  const source = sourceLabel(kind);
  const [fields, setFields] = useState(() => initialFields(item));
  // The scope is deliberately captured once when the editor opens. A late account
  // switch must reject the write rather than applying it to the new account.
  const [scope] = useState(() => queryClient.getQueryData<string>(queryKeys.agendaScope) ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const demo = isRendererDemoMode();
  const [eventForEditing, setEventForEditing] = useState<CalendarEventItem | null>(() =>
    isCalendarEvent(item) ? item : null,
  );
  const [loadingEvent, setLoadingEvent] = useState(kind === "event" && !demo);
  const [eventLoadError, setEventLoadError] = useState<string | null>(null);
  const title = fields.title.trim();
  const eventTimesValid = itemEditorCanSave(kind, fields);
  const saveDisabled =
    demo || !scope || !title || !eventTimesValid || loadingEvent || Boolean(eventLoadError);

  useEffect(() => {
    if (kind !== "event" || demo || !scope) return;
    const event = item as CalendarEventItem;
    let cancelled = false;
    void invoke<CalendarEventItem>("calendar:getForEditing", {
      calendarId: event.calendarId,
      eventId: event.id,
      expectedScope: scope,
    })
      .then((fullEvent) => {
        if (cancelled) return;
        setEventForEditing(fullEvent);
        setFields(eventEditorFields(fullEvent));
      })
      .catch((error) => {
        if (!cancelled) setEventLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingEvent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, item, kind, scope]);

  function setField<Key extends keyof typeof fields>(key: Key, value: (typeof fields)[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function setAllDay(allDay: boolean) {
    setFields((current) => {
      if (allDay) {
        const start = current.start.slice(0, 10);
        const end = current.end.slice(0, 10) || start;
        return { ...current, allDay, start, end: end < start ? start : end };
      }
      const start = current.start.slice(0, 10);
      const end = current.end.slice(0, 10);
      return {
        ...current,
        allDay,
        start: `${start}T09:00`,
        end: `${end}T10:00`,
      };
    });
  }

  async function save() {
    if (saveDisabled) return;
    setSaveError(null);
    try {
      let updated: TaskItem | ReminderItem | CalendarEventItem;
      if (kind === "task") {
        const task = (item as Todo).task!;
        updated = await invoke<TaskItem>("tasks:update", {
          listId: task.listId,
          taskId: task.id,
          title,
          notes: fields.notes,
          due: fields.dueDate || null,
          expectedScope: scope,
        });
      } else if (kind === "reminder") {
        const reminder = (item as Todo).reminder!;
        const dueChanged = reminderDueChanged(reminder, fields);
        updated = await invoke<ReminderItem>("reminders:update", {
          ref: reminder.ref,
          title,
          notes: fields.notes,
          dueChanged,
          ...(dueChanged
            ? {
                dueDate: fields.dueDate || null,
                dueTime: fields.dueDate && fields.dueTime ? fields.dueTime : null,
              }
            : {}),
          priority: Number(fields.priority),
          expectedScope: scope,
        });
      } else {
        const event = eventForEditing ?? (item as CalendarEventItem);
        const description = changedCalendarDescription(event, fields);
        updated = await invoke<CalendarEventItem>("calendar:update", {
          calendarId: event.calendarId,
          eventId: event.id,
          title,
          location: fields.location,
          ...(description === undefined ? {} : { description }),
          start: fields.allDay ? fields.start : dateTimeInputToIso(fields.start),
          end: fields.allDay ? nextCalendarDate(fields.end) : dateTimeInputToIso(fields.end),
          allDay: fields.allDay,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timesChanged: eventTimesChanged(event, fields),
          expectedScope: scope,
        });
      }
      if (queryClient.getQueryData<string>(queryKeys.agendaScope) !== scope) {
        onSaved();
        return;
      }
      replaceSourceItem(queryClient, kind, item, updated);
      if (kind === "reminder" && (updated as ReminderItem).agendaSaveError)
        toast.error((updated as ReminderItem).agendaSaveError!);
      void queryClient.invalidateQueries({ queryKey: sourceKey(kind) });
      if (kind === "event") {
        void queryClient.invalidateQueries({ queryKey: ["calendar", "range"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.review });
      }
      toast.success(`Saved “${updated.title}”`);
      onSaved();
    } catch (error) {
      setSaveError(errorMessage(error));
      throw error;
    }
  }

  async function deleteItem() {
    if (!scope || demo) return;
    setSaveError(null);
    try {
      if (kind === "task") {
        const task = (item as Todo).task!;
        await invoke("tasks:delete", {
          listId: task.listId,
          taskId: task.id,
          expectedScope: scope,
        });
      } else if (kind === "reminder") {
        const reminder = (item as Todo).reminder!;
        await invoke("reminders:delete", {
          ref: reminder.ref,
          expectedScope: scope,
        });
      } else {
        const event = item as CalendarEventItem;
        const result = await invoke<{ agendaSaveError?: string }>("calendar:delete", {
          calendarId: event.calendarId,
          eventId: event.id,
          expectedScope: scope,
        });
        if (result?.agendaSaveError) toast.error(result.agendaSaveError);
      }
      if (queryClient.getQueryData<string>(queryKeys.agendaScope) !== scope) {
        onSaved();
        return;
      }
      removeSourceItem(queryClient, kind, item);
      void queryClient.invalidateQueries({ queryKey: sourceKey(kind) });
      if (kind === "event") {
        void queryClient.invalidateQueries({ queryKey: ["calendar", "range"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.review });
      }
      toast.success(`Deleted “${item.title}”`);
      onSaved();
    } catch (error) {
      setDeleting(false);
      setSaveError(errorMessage(error));
      throw error;
    }
  }

  const dateDescription =
    kind === "task"
      ? "A date only. Leave blank to clear it."
      : "Leave blank to remove the deadline.";
  const eventDescription = fields.allDay
    ? "End date is inclusive."
    : "Times use this Mac’s local time zone.";

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => !next && onClose()}
        title={`Edit ${source === "Google Calendar" ? "event" : "item"}`}
        description={source}
        confirmLabel="Save"
        confirmDisabled={saveDisabled}
        onConfirm={save}
        destructiveAction={{
          label: "Delete",
          onClick: () => setDeleting(true),
        }}
        size="large"
      >
        <div className="flex flex-col gap-4">
          {demo ? (
            <Callout color="blue">
              Demo content is read-only. Exit demo mode to save or delete.
            </Callout>
          ) : null}
          {!scope ? (
            <Callout color="orange">Loading the signed-in account. Try again in a moment.</Callout>
          ) : null}
          {saveError ? <Callout color="red">{saveError}</Callout> : null}
          {eventLoadError ? (
            <Callout color="red">Couldn’t load this event’s full details: {eventLoadError}</Callout>
          ) : null}
          <FieldGroup>
            <Field
              label="Title"
              htmlFor={`${fieldId}-title`}
              orientation="vertical"
              error={!title ? "A title is required." : undefined}
            >
              <Input
                id={`${fieldId}-title`}
                value={fields.title}
                onChange={(event) => setField("title", event.target.value)}
                disabled={demo}
                aria-invalid={!title}
                autoFocus
              />
            </Field>
            <Field
              label={kind === "event" ? "Description" : "Notes"}
              htmlFor={`${fieldId}-notes`}
              orientation="vertical"
            >
              <Textarea
                id={`${fieldId}-notes`}
                value={fields.notes}
                onChange={(event) => setField("notes", event.target.value)}
                disabled={demo}
                rows={4}
              />
            </Field>
            {kind === "event" ? (
              <Text variant="small" color="secondary">
                Editing the description replaces Google Calendar formatting with plain text. Leave
                it unchanged to preserve formatting.
              </Text>
            ) : null}
            {kind === "task" || kind === "reminder" ? (
              <>
                <Field
                  label="Deadline"
                  htmlFor={`${fieldId}-due`}
                  description={dateDescription}
                  orientation="vertical"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${fieldId}-due`}
                      type="date"
                      value={fields.dueDate}
                      onChange={(event) => setField("dueDate", event.target.value)}
                      disabled={demo}
                    />
                    {fields.dueDate ? (
                      <Button
                        size="small"
                        variant="transparent"
                        disabled={demo}
                        onClick={() => {
                          setField("dueDate", "");
                          setField("dueTime", "");
                        }}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </Field>
                {kind === "reminder" ? (
                  <>
                    <Field
                      label="Time"
                      htmlFor={`${fieldId}-time`}
                      description="Optional."
                      orientation="vertical"
                    >
                      <Input
                        id={`${fieldId}-time`}
                        type="time"
                        value={fields.dueTime}
                        onChange={(event) => setField("dueTime", event.target.value)}
                        disabled={demo || !fields.dueDate}
                      />
                    </Field>
                    <Field label="Priority" htmlFor={`${fieldId}-priority`} orientation="vertical">
                      <Select
                        value={fields.priority}
                        onValueChange={(value) => setField("priority", value)}
                        disabled={demo}
                      >
                        <SelectTrigger id={`${fieldId}-priority`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">None</SelectItem>
                          <SelectItem value="1">High</SelectItem>
                          <SelectItem value="5">Medium</SelectItem>
                          <SelectItem value="9">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Field label="All-day" orientation="vertical">
                  <label className="flex items-center gap-2 text-regular text-secondary">
                    <Checkbox
                      checked={fields.allDay}
                      onCheckedChange={(checked) => setAllDay(checked === true)}
                      disabled={demo}
                    />
                    This event lasts all day
                  </label>
                </Field>
                <Field
                  label={fields.allDay ? "Start date" : "Start"}
                  htmlFor={`${fieldId}-start`}
                  description={eventDescription}
                  orientation="vertical"
                >
                  <Input
                    id={`${fieldId}-start`}
                    type={fields.allDay ? "date" : "datetime-local"}
                    value={fields.start}
                    onChange={(event) => setField("start", event.target.value)}
                    disabled={demo}
                    aria-invalid={!fields.start}
                  />
                </Field>
                <Field
                  label={fields.allDay ? "End date" : "End"}
                  htmlFor={`${fieldId}-end`}
                  description={fields.allDay ? "The last day the event appears." : eventDescription}
                  orientation="vertical"
                  error={eventTimesValid ? undefined : "End must be after the start."}
                >
                  <Input
                    id={`${fieldId}-end`}
                    type={fields.allDay ? "date" : "datetime-local"}
                    value={fields.end}
                    min={fields.start || undefined}
                    onChange={(event) => setField("end", event.target.value)}
                    disabled={demo}
                    aria-invalid={!eventTimesValid}
                  />
                </Field>
                <Field label="Location" htmlFor={`${fieldId}-location`} orientation="vertical">
                  <Input
                    id={`${fieldId}-location`}
                    value={fields.location}
                    onChange={(event) => setField("location", event.target.value)}
                    disabled={demo}
                  />
                </Field>
              </>
            )}
          </FieldGroup>
          <Text variant="small" color="secondary">
            This edits only this {kind === "event" ? "event occurrence" : "item"}. Linked items are
            unchanged.
          </Text>
        </div>
      </Dialog>
      <AlertDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${item.title}”?`}
        description={
          kind === "event"
            ? `This permanently deletes the selected event from ${source}. If it repeats, only this occurrence is deleted.`
            : `This permanently deletes this ${source} item. Linked items are unchanged.`
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={deleteItem}
        confirmDisabled={demo || !scope}
      />
    </>
  );
}
