import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@glaze/core/components";
import { ComposerPopup } from "./composer-popup";

export interface ComposerMenuEntry {
  /** Unique value of the entry in the list. */
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
  /** Accessible name of the list: "Commands" or "Mentions". */
  label: string;
  sections: ComposerMenuSection[];
  /** Shown when no section has entries. */
  empty?: string;
}

/**
 * The list above the composer for `/` commands and `@` mentions, on Glaze's Command. Focus stays
 * in the textarea, which drives the list from the keyboard. Command assigns the option ids, so the
 * textarea's aria attributes are read from the rendered list.
 */
export function ComposerMenu({
  menu,
  activeId,
  anchorRef,
  textareaRef,
  onHover,
  onDismiss,
}: {
  menu: ComposerMenuModel | null;
  activeId: string | null;
  /** The composer surface; presses inside it keep the list open. */
  anchorRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onHover: (id: string) => void;
  onDismiss: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Point the textarea at the rendered list and its selected option. Command marks the option
  // for a new value in a render after this effect runs, so read the list on the next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const list = listRef.current?.querySelector<HTMLElement>('[role="listbox"]');
      const active = list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
      if (list?.id) textarea.setAttribute("aria-controls", list.id);
      else textarea.removeAttribute("aria-controls");
      if (active?.id) textarea.setAttribute("aria-activedescendant", active.id);
      else textarea.removeAttribute("aria-activedescendant");
      active?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!listRef.current?.contains(target) && !anchorRef.current?.contains(target)) onDismiss();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu, anchorRef, onDismiss]);

  if (!menu) return null;
  return (
    <ComposerPopup
      anchorRef={anchorRef}
      popupRef={listRef}
      className="rounded-xl border border-separator bg-[var(--color-surface-popover)] p-1 shadow-xl"
    >
      <Command
        shouldFilter={false}
        value={activeId ?? ""}
        onValueChange={onHover}
        label={menu.label}
      >
        <CommandList label={menu.label} className="max-h-80 overflow-y-auto">
          {menu.sections.map((section) => (
            <CommandGroup key={section.id} heading={section.title}>
              {section.entries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={entry.id}
                  onSelect={() => entry.run("enter")}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {entry.icon}
                  <span className="shrink-0">{entry.label}</span>
                  {entry.detail ? (
                    <span className="min-w-0 truncate text-small text-tertiary">
                      {entry.detail}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {menu.empty ? <CommandEmpty>{menu.empty}</CommandEmpty> : null}
        </CommandList>
      </Command>
    </ComposerPopup>
  );
}
