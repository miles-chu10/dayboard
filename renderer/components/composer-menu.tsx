import { useEffect, type ReactNode, type RefObject } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";

export interface ComposerMenuEntry {
  /** DOM id; the textarea points at the active one with aria-activedescendant. */
  id: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  run: (via: "enter" | "tab") => void;
}

export interface ComposerMenuSection {
  id: string;
  title: string;
  entries: ComposerMenuEntry[];
}

export interface ComposerMenuModel {
  /** Accessible name of the listbox: "Commands" or "Mentions". */
  label: string;
  sections: ComposerMenuSection[];
  /** Shown when no section has entries. */
  empty?: string;
}

/**
 * The listbox above the composer for `/` commands and `@` mentions. Focus stays in the textarea,
 * which drives the list from the keyboard and points at the active option.
 */
export function ComposerMenu({
  listId,
  menu,
  activeId,
  anchorRef,
  onHover,
  onDismiss,
}: {
  listId: string;
  menu: ComposerMenuModel | null;
  activeId: string | null;
  /** The composer surface the list sits above. */
  anchorRef: RefObject<HTMLDivElement | null>;
  onHover: (id: string) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const empty = Boolean(menu?.empty) && !menu?.sections.some((section) => section.entries.length);
  return (
    <Popover
      open={Boolean(menu)}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLDivElement>} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div role="listbox" id={listId} aria-label={menu?.label}>
          {menu?.sections.map((section) => (
            <div key={section.id} role="group" aria-labelledby={`${listId}-${section.id}`}>
              <div
                id={`${listId}-${section.id}`}
                className="px-2 pb-0.5 pt-1.5 text-small text-tertiary"
              >
                {section.title}
              </div>
              {section.entries.map((entry) => (
                <div
                  key={entry.id}
                  id={entry.id}
                  role="option"
                  aria-selected={entry.id === activeId}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => onHover(entry.id)}
                  onClick={() => entry.run("enter")}
                  className={cn(
                    "flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-regular text-primary",
                    entry.id === activeId && "bg-list-hover",
                  )}
                >
                  {entry.icon}
                  <span className="shrink-0">{entry.label}</span>
                  {entry.detail ? (
                    <span className="min-w-0 truncate text-small text-tertiary">
                      {entry.detail}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          {empty ? <div className="px-2 py-1.5 text-small text-tertiary">{menu?.empty}</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
