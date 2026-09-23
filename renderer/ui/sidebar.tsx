import * as React from "react";

import { cn } from "./utils";
import { Text } from "./text";
import {
  CollapsibleRoot,
  CollapsibleContent,
  CollapsibleChevron,
  CollapsibleTrigger,
} from "./collapsible";

export type ToolbarSearchInputProps = React.ComponentProps<"input">;

export const ToolbarSearchInput = React.forwardRef<HTMLInputElement, ToolbarSearchInputProps>(
  ({ className, placeholder = "Search", ...props }, ref) => (
    <input
      ref={ref}
      type="search"
      placeholder={placeholder}
      className={cn(
        "h-7 w-full rounded-full border border-transparent bg-control-subtle px-3 text-small text-primary outline-none",
        "placeholder:text-tertiary focus:border-field",
        className,
      )}
      {...props}
    />
  ),
);
ToolbarSearchInput.displayName = "ToolbarSearchInput";

export interface SidebarProps extends React.ComponentProps<"div"> {
  actions?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  scrollEnabled?: boolean;
}

export function Sidebar({
  children,
  actions,
  searchable,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  toolbar,
  footer,
  scrollEnabled = true,
  className,
  ...props
}: SidebarProps) {
  const resolvedToolbar =
    toolbar ??
    (actions || searchable ? (
      <div className="flex flex-col gap-1.5 pl-2 pr-[5px] pt-2">
        {actions ? <div className="flex items-center justify-end gap-1">{actions}</div> : null}
        {searchable ? (
          <ToolbarSearchInput
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
          />
        ) : null}
      </div>
    ) : null);

  return (
    <div
      className={cn("flex h-full min-w-0 flex-col bg-background-secondary", className)}
      {...props}
    >
      {resolvedToolbar}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1 px-2 py-2",
          scrollEnabled && "overflow-y-auto",
        )}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("shrink-0 border-t border-separator/60 pt-1", className)} {...props} />;
}

export interface SidebarListProps<T> extends Omit<React.ComponentProps<"div">, "onSelect"> {
  items?: T[];
  selectedItem?: T | null;
  onSelectedItemChange?: (item: T) => void;
  getItemKey?: (item: T) => string;
  emptyState?: React.ReactNode;
}

export function SidebarList<T>({
  items,
  selectedItem: _selectedItem,
  onSelectedItemChange: _onSelectedItemChange,
  getItemKey: _getItemKey,
  emptyState,
  className,
  children,
  ...props
}: SidebarListProps<T>) {
  if (items && items.length === 0 && emptyState) {
    return (
      <div className={cn("flex flex-1 items-center justify-center", className)}>{emptyState}</div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-0.5", className)} {...props}>
      {children}
    </div>
  );
}

export interface SidebarListGroupProps extends Omit<React.ComponentProps<"div">, "title"> {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  forceOpen?: boolean;
}

export function SidebarListGroup({
  title,
  actions,
  collapsible,
  defaultOpen = true,
  open,
  onOpenChange,
  forceOpen,
  className,
  children,
  ...props
}: SidebarListGroupProps) {
  const body = <div className={cn("flex flex-col gap-0.5", className)}>{children}</div>;
  if (collapsible) {
    return (
      <CollapsibleRoot
        open={forceOpen || open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        {...(props as React.ComponentProps<"div">)}
      >
        <div className="group flex items-center gap-1 px-2 py-1">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1">
            <CollapsibleChevron />
            {title ? <SidebarListGroupTitle>{title}</SidebarListGroupTitle> : null}
          </CollapsibleTrigger>
          {actions ? <div className="opacity-0 group-hover:opacity-100">{actions}</div> : null}
        </div>
        <CollapsibleContent>{body}</CollapsibleContent>
      </CollapsibleRoot>
    );
  }
  return (
    <div {...props}>
      {title || actions ? (
        <div className="flex items-center gap-1 px-2 py-1">
          {title ? <SidebarListGroupTitle>{title}</SidebarListGroupTitle> : null}
          {actions ? <div className="ml-auto">{actions}</div> : null}
        </div>
      ) : null}
      {body}
    </div>
  );
}

export function SidebarListGroupTitle({
  asChild,
  className,
  children,
  ...props
}: React.ComponentProps<"h2"> & { asChild?: boolean }) {
  const Comp = asChild ? "span" : "h2";
  return (
    <Comp
      className={cn("truncate text-small font-medium text-tertiary", className)}
      {...(props as React.ComponentProps<"h2">)}
    >
      {children}
    </Comp>
  );
}

export interface SidebarListItemProps<T = unknown> extends Omit<
  React.ComponentProps<"button">,
  "onClick" | "title"
> {
  item?: T;
  selected?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  accessory?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  forceOpen?: boolean;
}

export function SidebarListItem<T>({
  item: _item,
  selected,
  onClick,
  icon,
  title,
  subtitle,
  accessory,
  collapsible,
  defaultOpen = false,
  open,
  onOpenChange,
  forceOpen,
  className,
  children,
  ...props
}: SidebarListItemProps<T>) {
  const propsMode = title !== undefined;
  const row = (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex min-h-[var(--density-row)] w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors",
        selected ? "bg-list-selection text-primary" : "text-primary hover:bg-list-hover",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
          {icon}
        </span>
      ) : null}
      {propsMode ? (
        <SidebarListItemContent>
          <SidebarListItemTitle truncate>{title}</SidebarListItemTitle>
          {subtitle ? <SidebarListItemSubtitle>{subtitle}</SidebarListItemSubtitle> : null}
        </SidebarListItemContent>
      ) : (
        children
      )}
      {accessory !== undefined ? (
        typeof accessory === "string" || typeof accessory === "number" ? (
          <SidebarListItemAccessory>{accessory}</SidebarListItemAccessory>
        ) : (
          accessory
        )
      ) : null}
    </button>
  );

  if (collapsible && propsMode) {
    return (
      <CollapsibleRoot
        open={forceOpen || open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
      >
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <span className="flex flex-1">{row}</span>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="ml-4 flex flex-col gap-0.5 border-l border-separator/60 pl-2">
            {children}
          </div>
        </CollapsibleContent>
      </CollapsibleRoot>
    );
  }
  return row;
}

export function SidebarListItemContent({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("flex min-w-0 flex-1 flex-col", className)} {...props} />;
}

export function SidebarListItemTitle(props: React.ComponentProps<typeof Text>) {
  return <Text {...props} />;
}

export function SidebarListItemSubtitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("truncate text-small text-tertiary", className)} {...props} />;
}

export function SidebarListItemAccessory({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 items-center gap-1 text-small text-tertiary tabular-nums",
        className,
      )}
      {...props}
    />
  );
}
