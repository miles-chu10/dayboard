import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "./utils";
import {
  MenuIcon,
  menuItemColorClass,
  menuItemColorStyle,
  type NativeMenuIcon,
  type MenuItemColor,
} from "./menu-icon";

export function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root {...props} />;
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[10rem] max-w-72 overflow-hidden rounded-xl border border-separator bg-background/95 p-1 shadow-xl backdrop-blur-xl",
          "origin-[--radix-dropdown-menu-content-transform-origin]",
          "data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

interface DropdownMenuItemExtra {
  icon?: NativeMenuIcon;
  sublabel?: string;
  accelerator?: string;
  color?: MenuItemColor;
  iconColor?: MenuItemColor;
}

function itemRowClass(disabled?: boolean) {
  return cn(
    "flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-regular text-primary outline-none",
    "data-[highlighted]:bg-list-hover",
    disabled && "pointer-events-none opacity-40",
  );
}

export interface DropdownMenuItemProps
  extends
    Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Item>, "color">,
    DropdownMenuItemExtra {}

export function DropdownMenuItem({
  icon,
  sublabel,
  accelerator,
  color,
  iconColor,
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item className={cn(itemRowClass(props.disabled), className)} {...props}>
      <MenuIcon
        icon={icon}
        className={cn("size-4 shrink-0", menuItemColorClass(iconColor ?? color))}
      />
      <span
        className={cn("min-w-0 flex-1 truncate", menuItemColorClass(color))}
        style={menuItemColorStyle(color)}
      >
        {children}
        {sublabel ? (
          <span className="block truncate text-small text-tertiary">{sublabel}</span>
        ) : null}
      </span>
      {accelerator ? (
        <span className="shrink-0 text-small text-tertiary">{accelerator}</span>
      ) : null}
    </DropdownMenuPrimitive.Item>
  );
}

export interface DropdownMenuCheckboxItemProps
  extends
    Omit<React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>, "color">,
    Omit<DropdownMenuItemExtra, "accelerator"> {}

export function DropdownMenuCheckboxItem({
  icon,
  sublabel,
  color,
  iconColor,
  checked,
  className,
  children,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(itemRowClass(props.disabled), className)}
      {...props}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {icon ? (
        <MenuIcon
          icon={icon}
          className={cn("size-4 shrink-0", menuItemColorClass(iconColor ?? color))}
        />
      ) : null}
      <span
        className={cn("min-w-0 flex-1 truncate", menuItemColorClass(color))}
        style={menuItemColorStyle(color)}
      >
        {children}
        {sublabel ? (
          <span className="block truncate text-small text-tertiary">{sublabel}</span>
        ) : null}
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export interface DropdownMenuSubProps extends Omit<
  DropdownMenuItemExtra,
  "accelerator" | "sublabel"
> {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}

export function DropdownMenuSub({
  label,
  icon,
  color,
  iconColor,
  disabled,
  children,
}: DropdownMenuSubProps) {
  return (
    <DropdownMenuPrimitive.Sub>
      <DropdownMenuPrimitive.SubTrigger disabled={disabled} className={itemRowClass(disabled)}>
        <MenuIcon
          icon={icon}
          className={cn("size-4 shrink-0", menuItemColorClass(iconColor ?? color))}
        />
        <span
          className={cn("min-w-0 flex-1 truncate", menuItemColorClass(color))}
          style={menuItemColorStyle(color)}
        >
          {label}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-tertiary" />
      </DropdownMenuPrimitive.SubTrigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.SubContent
          sideOffset={4}
          className="z-50 min-w-[10rem] max-w-72 overflow-hidden rounded-xl border border-separator bg-background/95 p-1 shadow-xl backdrop-blur-xl"
        >
          {children}
        </DropdownMenuPrimitive.SubContent>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Sub>
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-separator", className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1 text-small text-tertiary", className)}
      {...props}
    />
  );
}

export function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group {...props} />;
}
