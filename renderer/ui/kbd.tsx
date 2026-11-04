import { cn } from "./utils";

/** One key cap, sized like the shortcut keys in tooltips. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded bg-control px-1 text-[11px] font-medium text-secondary tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function KeyCaps({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </span>
  );
}
