import * as React from "react";
import { ArrowUp, Loader2, Square, ChevronRight, Wrench } from "lucide-react";

import { cn } from "./utils";
import { Button } from "./button";

// ---- Composer -------------------------------------------------------------

function ComposerRoot({ className, ...props }: React.ComponentProps<"form">) {
  return <form className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function ComposerSurface({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-2xl border border-field bg-background/90 px-1 py-1 shadow-sm backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

function ComposerRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-end gap-1 px-1.5", className)} {...props} />;
}

const ComposerInput = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, onKeyDown, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={1}
      className={cn(
        "max-h-40 min-h-8 w-full resize-none [field-sizing:content] self-center bg-transparent py-1.5 text-regular text-primary outline-none",
        "placeholder:text-tertiary disabled:opacity-40",
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.shiftKey && !event.defaultPrevented) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
      {...props}
    />
  ),
);
ComposerInput.displayName = "AIChat.Composer.Input";

function ComposerActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export interface ComposerSubmitProps extends Omit<React.ComponentProps<typeof Button>, "children"> {
  action?: "send" | "stop";
}

function ComposerSubmit({
  action = "send",
  type = "submit",
  className,
  ...props
}: ComposerSubmitProps) {
  return (
    <Button
      iconOnly
      size="small"
      variant="accent"
      type={type}
      aria-label={action === "stop" ? "Stop" : "Send"}
      className={cn("rounded-full", className)}
      {...props}
    >
      {action === "stop" ? <Square className="fill-current" /> : <ArrowUp />}
    </Button>
  );
}

// ---- Conversation -----------------------------------------------------------

function ConversationContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-4 px-4 py-3", className)} {...props} />;
}

function ConversationAnchor(props: React.ComponentProps<"div">) {
  return <div aria-hidden {...props} />;
}

// ---- Message -----------------------------------------------------------

export interface MessageRootProps extends React.ComponentProps<"div"> {
  from: "user" | "assistant" | "system";
}

function MessageRoot({ from, className, ...props }: MessageRootProps) {
  return (
    <div
      data-from={from}
      className={cn(
        "flex flex-col gap-1.5",
        from === "user" && "items-end",
        from === "system" && "items-center text-center",
        className,
      )}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  const from = React.useContext(MessageFromContext);
  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-2",
        from === "user" && "rounded-2xl bg-control px-3 py-2 text-primary",
        className,
      )}
      {...props}
    />
  );
}

const MessageFromContext = React.createContext<MessageRootProps["from"] | undefined>(undefined);

function MessageRootWithContext(props: MessageRootProps) {
  return (
    <MessageFromContext.Provider value={props.from}>
      <MessageRoot {...props} />
    </MessageFromContext.Provider>
  );
}

function MessageActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export interface MessageActionProps extends React.ComponentProps<"button"> {
  tooltip?: string;
  asChild?: boolean;
}

function MessageAction({ tooltip, asChild, children, ...props }: MessageActionProps) {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ title?: string }>, {
      title: tooltip ?? (children.props as { title?: string }).title,
    });
  }
  return (
    <button type="button" title={tooltip} {...props}>
      {children}
    </button>
  );
}

// ---- Reasoning -----------------------------------------------------------

export interface ReasoningRootProps extends React.ComponentProps<"div"> {
  status?: "streaming" | "complete";
}

function ReasoningRoot({ status, className, children, ...props }: ReasoningRootProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(
              child as React.ReactElement<{
                status?: string;
                open?: boolean;
                onToggle?: () => void;
              }>,
              {
                status,
                open,
                onToggle: () => setOpen((value) => !value),
              },
            )
          : child,
      )}
    </div>
  );
}

interface ReasoningTriggerProps extends React.ComponentProps<"button"> {
  status?: "streaming" | "complete";
  open?: boolean;
  onToggle?: () => void;
}

function ReasoningTrigger({
  status,
  open,
  onToggle,
  className,
  children,
  ...props
}: ReasoningTriggerProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn("flex items-center gap-1.5 text-small text-tertiary", className)}
      {...props}
    >
      {status === "streaming" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      )}
      {children}
    </button>
  );
}

interface ReasoningContentProps extends React.ComponentProps<"div"> {
  open?: boolean;
}

function ReasoningContent({ open, className, ...props }: ReasoningContentProps) {
  if (!open) return null;
  return <div className={cn("pl-5 text-small text-tertiary", className)} {...props} />;
}

// ---- Tool -----------------------------------------------------------

export interface ToolRootProps extends React.ComponentProps<"div"> {
  status?: "pending" | "running" | "complete" | "error";
}

const ToolStatusContext = React.createContext<ToolRootProps["status"]>(undefined);

function ToolRoot({ status, className, children, ...props }: ToolRootProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-separator bg-well px-2.5 py-1.5 text-small",
        className,
      )}
      {...props}
    >
      <ToolStatusContext.Provider value={status}>{children}</ToolStatusContext.Provider>
    </div>
  );
}

function ToolTrigger({ className, children, ...props }: React.ComponentProps<"div">) {
  const status = React.useContext(ToolStatusContext);
  return (
    <div className={cn("flex items-center gap-1.5", className)} {...props}>
      {status === "running" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-tertiary" />
      ) : status === "error" ? (
        <Wrench className="size-3.5 shrink-0 text-support-red" />
      ) : (
        <Wrench className="size-3.5 shrink-0 text-tertiary" />
      )}
      {children}
    </div>
  );
}

function ToolName({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("truncate text-primary", className)} {...props} />;
}

// ---- Namespace -----------------------------------------------------------

export const AIChat = {
  Composer: {
    Root: ComposerRoot,
    Surface: ComposerSurface,
    Row: ComposerRow,
    Input: ComposerInput,
    Actions: ComposerActions,
    Submit: ComposerSubmit,
  },
  Conversation: {
    Content: ConversationContent,
    Anchor: ConversationAnchor,
  },
  Message: {
    Root: MessageRootWithContext,
    Content: MessageContent,
    Actions: MessageActions,
    Action: MessageAction,
  },
  Reasoning: {
    Root: ReasoningRoot,
    Trigger: ReasoningTrigger,
    Content: ReasoningContent,
  },
  Tool: {
    Root: ToolRoot,
    Trigger: ToolTrigger,
    Name: ToolName,
  },
};
