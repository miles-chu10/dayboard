export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

/** ⌘N and nothing else: Shift, Option and Control variants belong to other commands. */
export function isNewItemShortcut(event: KeyEventLike): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.defaultPrevented &&
    !event.isComposing &&
    event.key.toLowerCase() === "n"
  );
}
