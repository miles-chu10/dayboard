export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

/** Match the native New Item command without taking other commands or composed input. */
export function isNewItemShortcut(event: KeyEventLike): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    event.key.toLowerCase() === "n"
  );
}
