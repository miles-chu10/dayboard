import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "./utils";
import { Button, type ButtonProps } from "./button";

export interface ToolbarProps extends React.ComponentProps<"div"> {
  position?: "top" | "bottom";
  inset?: "none" | "windowControls" | "windowControlsAndButton";
  background?: "progressive-blur" | "full-blur";
  disableLayoutTransition?: boolean;
}

const INSET_CLASS = {
  none: "",
  windowControls: "pl-20",
  windowControlsAndButton: "pl-24",
} as const;

export function Toolbar({
  position = "top",
  inset = "windowControls",
  background = "progressive-blur",
  disableLayoutTransition,
  className,
  children,
  ...props
}: ToolbarProps) {
  const hasRow = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === ToolbarRow,
  );
  return (
    <div
      data-toolbar
      className={cn(
        "relative z-10 flex shrink-0 flex-col",
        position === "top" && "drag-region",
        background === "full-blur"
          ? "backdrop-blur-xl border-b border-separator"
          : "backdrop-blur-md",
        !disableLayoutTransition && "transition-[height]",
        className,
      )}
      {...props}
    >
      {hasRow ? (
        React.Children.map(children, (child, index) =>
          React.isValidElement(child) && child.type === ToolbarRow && index === 0
            ? React.cloneElement(child as React.ReactElement<ToolbarRowProps>, {
                className: cn(INSET_CLASS[inset], (child.props as ToolbarRowProps).className),
              })
            : child,
        )
      ) : (
        <ToolbarRow className={INSET_CLASS[inset]}>{children}</ToolbarRow>
      )}
    </div>
  );
}

type ToolbarRowProps = React.ComponentProps<"div">;

export function ToolbarRow({ className, ...props }: ToolbarRowProps) {
  return <div className={cn("flex h-13 min-h-9 items-center gap-2 px-2", className)} {...props} />;
}

export function ToolbarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col justify-center", className)} {...props} />
  );
}

export function ToolbarTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 className={cn("truncate text-[15px] font-medium text-primary", className)} {...props} />
  );
}

export function ToolbarDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("truncate text-small text-secondary", className)} {...props} />;
}

export function ToolbarActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("ml-auto flex shrink-0 items-center gap-1.5", className)} {...props} />;
}

export interface ToolbarBackButtonProps extends Omit<ButtonProps, "children" | "iconOnly"> {
  label?: string;
}

export function ToolbarBackButton({
  label = "Back",
  variant = "glass",
  size = "large",
  ...props
}: ToolbarBackButtonProps) {
  return (
    <Button iconOnly aria-label={label} title={label} variant={variant} size={size} {...props}>
      <ChevronLeft />
    </Button>
  );
}

export interface ToolbarSearchButtonRef {
  focus: () => void;
  blur: () => void;
}

export interface ToolbarSearchButtonProps {
  value?: string;
  onChange?: (value: string) => void;
  size?: "small" | "medium" | "large";
}

export const ToolbarSearchButton = React.forwardRef<
  ToolbarSearchButtonRef,
  ToolbarSearchButtonProps
>(({ value, onChange, size = "medium" }, ref) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = React.useState(Boolean(value));
  React.useImperativeHandle(ref, () => ({
    focus: () => {
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    blur: () => inputRef.current?.blur(),
  }));
  const sizeClass = size === "small" ? "size-7" : size === "large" ? "size-9" : "size-8";
  return expanded ? (
    <input
      ref={inputRef}
      type="search"
      autoFocus
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onBlur={() => {
        if (!value) setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (value) onChange?.("");
          else setExpanded(false);
        }
      }}
      className={cn(
        "h-8 w-[200px] rounded-full border border-field bg-control-subtle px-3 text-small outline-none",
      )}
    />
  ) : (
    <Button
      iconOnly
      variant="transparent"
      size={size}
      aria-label="Search"
      onClick={() => setExpanded(true)}
      className={sizeClass}
    >
      <SearchIcon />
    </Button>
  );
});
ToolbarSearchButton.displayName = "ToolbarSearchButton";

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
