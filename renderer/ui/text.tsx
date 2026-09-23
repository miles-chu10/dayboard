import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "./utils";

export type TextVariant =
  | "heading1"
  | "heading2"
  | "extra-large"
  | "extra-large-strong"
  | "large"
  | "large-strong"
  | "regular"
  | "strong"
  | "small"
  | "small-strong"
  | "mini"
  | "mini-strong"
  | "mono"
  | "mono-strong"
  | "small-mono";

export type TextColor =
  | "primary"
  | "secondary"
  | "tertiary"
  | "quaternary"
  | "disabled"
  | "link"
  | "inherit"
  | "accent"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "magenta";

const VARIANT_CLASS: Record<TextVariant, string> = {
  heading1: "text-heading1 font-semibold",
  heading2: "text-heading2 font-semibold",
  "extra-large": "text-extra-large font-normal",
  "extra-large-strong": "text-extra-large font-medium",
  large: "text-large font-normal",
  "large-strong": "text-large font-medium",
  regular: "text-regular font-normal",
  strong: "text-regular font-medium",
  small: "text-small font-normal",
  "small-strong": "text-small font-medium",
  mini: "text-mini font-normal",
  "mini-strong": "text-mini font-medium",
  mono: "text-mono font-normal font-mono",
  "mono-strong": "text-mono font-semibold font-mono",
  "small-mono": "text-small-mono font-normal font-mono",
};

const COLOR_CLASS: Record<TextColor, string> = {
  primary: "text-primary",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  quaternary: "text-quaternary",
  disabled: "text-disabled",
  link: "text-link underline-offset-2 hover:underline",
  inherit: "text-inherit",
  accent: "text-accent",
  red: "text-support-red",
  orange: "text-support-orange",
  yellow: "text-support-yellow",
  green: "text-support-green",
  blue: "text-support-blue",
  purple: "text-support-purple",
  magenta: "text-support-magenta",
};

export interface TextProps extends Omit<React.ComponentProps<"span">, "color"> {
  variant?: TextVariant;
  color?: TextColor;
  align?: "left" | "center" | "right";
  truncate?: boolean;
  as?: React.ElementType;
  asChild?: boolean;
}

export function Text({
  variant = "regular",
  color = "primary",
  align,
  truncate,
  as: Component = "span",
  asChild,
  className,
  ...props
}: TextProps) {
  const Comp = asChild ? Slot.Root : Component;
  return (
    <Comp
      className={cn(
        VARIANT_CLASS[variant],
        COLOR_CLASS[color],
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        truncate && "truncate min-w-0",
        className,
      )}
      {...props}
    />
  );
}
