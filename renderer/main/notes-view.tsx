import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertDialog,
  Button,
  EmptyState,
  Input,
  Markdown,
  ScrollArea,
  Status,
  Text,
  Textarea,
} from "@renderer/ui";
import { ChevronLeft, Eye, NotebookPen, PencilLine, Plus, Trash2 } from "lucide-react";
import type { Note } from "@main/shared-types";

import { HistoryNav } from "../components/history-nav";
import { usePublishViewContext } from "../components/shell";
import { WindowActions } from "../components/view-actions";
import { useNoteActions, useNotes } from "../lib/agent-data";
import { errorMessage } from "../lib/ipc";

const SAVE_DELAY = 600;

function edited(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === new Date().toDateString()) return `Today, ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The first line of the body that isn't the title, for the list. */
function preview(note: Note): string {
  return (
    note.body
      .split("\n")
      .map((line) => line.replace(/^#+\s*|^[-*]\s+/, "").trim())
      .find((line) => line && line !== note.title) ?? ""
  );
}

function NotesList({ onOpen }: { onOpen: (id: string | "new") => void }) {
  const notes = useNotes();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = (notes.data ?? []).filter(
    (note) =>
      !needle ||
      note.title.toLowerCase().includes(needle) ||
      note.body.toLowerCase().includes(needle),
  );
  return (
    <ScrollArea
      className="h-full"
      leading={<HistoryNav />}
      viewportClassName="[&>div]:block!"
      title="Notes"
      subtitle={
        notes.data ? `${notes.data.length} ${notes.data.length === 1 ? "note" : "notes"}` : "Notes"
      }
      actions={
        <>
          <WindowActions />
          <Button iconOnly aria-label="New note" title="New note" onClick={() => onOpen("new")}>
            <Plus />
          </Button>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-6">
        {notes.isPending ? (
          <Status variant="loading">Loading notes…</Status>
        ) : notes.isError ? (
          <Text color="red">{errorMessage(notes.error)}</Text>
        ) : notes.data.length === 0 ? (
          <EmptyState
            media={<NotebookPen className="size-8 text-tertiary" />}
            title="No notes yet"
            description="Write one here, save an Assistant chat as a note, or let an agent add one over MCP."
            actions={<Button onClick={() => onOpen("new")}>New note</Button>}
          />
        ) : (
          <>
            <Input
              aria-label="Search notes"
              placeholder="Search notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul aria-label="Notes" className="flex flex-col">
              {shown.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                    onClick={() => onOpen(note.id)}
                  >
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <Text variant="strong" truncate>
                        {note.title}
                      </Text>
                      <Text variant="small" color="secondary" className="shrink-0">
                        {edited(note.updatedAt)}
                      </Text>
                    </span>
                    {preview(note) ? (
                      <Text variant="small" color="secondary" truncate>
                        {preview(note)}
                      </Text>
                    ) : null}
                  </button>
                </li>
              ))}
              {shown.length === 0 ? (
                <Text color="secondary" className="px-3 py-2">
                  No notes match “{query.trim()}”.
                </Text>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

type SaveState = "saved" | "unsaved" | "saving";

/** Saves a moment after typing stops, on ⌘S, and when the editor closes. */
function NoteEditor({ note, onBack }: { note: Note | null; onBack: () => void }) {
  const { save, remove } = useNoteActions();
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [previewing, setPreviewing] = useState(false);
  const [state, setState] = useState<SaveState>("saved");
  const [deleting, setDeleting] = useState(false);
  const id = useRef(note?.id);
  const pending = useRef<{ title: string; body: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Saves run one at a time, so a new note is created once and later saves update it.
  const chain = useRef<Promise<void>>(Promise.resolve());

  const persist = save.mutateAsync;
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const draft = pending.current;
      if (!draft) return;
      pending.current = null;
      if (!id.current && !draft.title.trim() && !draft.body.trim()) return setState("saved");
      setState("saving");
      try {
        const saved = await persist({
          ...(id.current ? { id: id.current } : {}),
          ...draft,
        });
        id.current = saved.id;
        setState(pending.current ? "unsaved" : "saved");
      } catch {
        setState("unsaved");
      }
    });
    return chain.current;
  }, [persist]);

  function change(next: { title: string; body: string }) {
    setTitle(next.title);
    setBody(next.body);
    pending.current = next;
    setState("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  }

  // Closing the editor or leaving Notes keeps what was typed.
  useEffect(() => () => void flush(), [flush]);

  async function back() {
    await flush();
    onBack();
  }

  async function deleteNote() {
    clearTimeout(timer.current);
    pending.current = null;
    await chain.current;
    if (id.current) await remove.mutateAsync(id.current);
    onBack();
  }

  return (
    <>
      <ScrollArea
        className="h-full"
        leading={
          <Button iconOnly aria-label="All notes" title="All notes" onClick={() => void back()}>
            <ChevronLeft />
          </Button>
        }
        viewportClassName="[&>div]:block!"
        title={
          title.trim() || (body.trim() ? body.split("\n")[0].replace(/^#+\s*/, "") : "New note")
        }
        subtitle={state === "saving" ? "Saving…" : state === "unsaved" ? "Edited" : "Saved"}
        actions={
          <>
            <WindowActions />
            <Button
              iconOnly
              aria-label={previewing ? "Edit" : "Preview"}
              title={previewing ? "Edit" : "Preview"}
              aria-pressed={previewing}
              onClick={() => setPreviewing((value) => !value)}
            >
              {previewing ? <PencilLine /> : <Eye />}
            </Button>
            <Button
              iconOnly
              aria-label="Delete note"
              title="Delete note"
              onClick={() => setDeleting(true)}
            >
              <Trash2 />
            </Button>
          </>
        }
      >
        <div
          className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-6"
          onKeyDown={(event) => {
            if (event.key === "s" && event.metaKey) {
              event.preventDefault();
              void flush();
            }
          }}
        >
          <Input
            aria-label="Note title"
            placeholder="Title"
            value={title}
            maxLength={200}
            onChange={(event) => change({ title: event.target.value, body })}
          />
          {previewing ? (
            <section
              aria-label="Note preview"
              className="min-h-80 rounded-lg border border-field px-3 py-2"
            >
              {body.trim() ? (
                <Markdown>{body}</Markdown>
              ) : (
                <Text color="secondary">Nothing to preview yet.</Text>
              )}
            </section>
          ) : (
            <Textarea
              aria-label="Note"
              placeholder="Write in Markdown…"
              autoFocus={!note}
              className="min-h-80 max-h-none px-3 font-mono text-small"
              value={body}
              onChange={(event) => change({ title, body: event.target.value })}
            />
          )}
        </div>
      </ScrollArea>
      <AlertDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this note?"
        description="It's removed from DayBoard. This can't be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={deleteNote}
      />
    </>
  );
}

export function NotesView() {
  usePublishViewContext({ view: "notes", title: "Notes" });
  const navigate = useNavigate();
  const notes = useNotes();
  const { note: requested } = useSearch({ from: "/notes" });
  const [open, setOpen] = useState<string | undefined>(requested);
  // A note requested later (⌘K, "Save chat as note") replaces what is open, once.
  const [lastRequested, setLastRequested] = useState(requested);
  if (requested !== lastRequested) {
    setLastRequested(requested);
    if (requested) setOpen(requested);
  }

  function close() {
    setOpen(undefined);
    if (requested) void navigate({ to: "/notes", search: {} });
  }

  if (!open) return <NotesList onOpen={setOpen} />;
  if (open === "new") return <NoteEditor key="new" note={null} onBack={close} />;
  const note = notes.data?.find((item) => item.id === open);
  if (note) return <NoteEditor key={note.id} note={note} onBack={close} />;
  if (notes.isPending || notes.isFetching) return <Status variant="loading">Loading note…</Status>;
  return <NotesList onOpen={setOpen} />;
}
