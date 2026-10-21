import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "./utils";

export interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  /** Accessible name of the single thumb, which carries role="slider". */
  thumbLabel: string;
  /** Spoken value, such as a level name instead of its index. */
  thumbValueText?: string;
  thumbClassName?: string;
  rangeClassName?: string;
}

/** A pill-shaped single-thumb slider: accent fill up to a white thumb. */
export function Slider({
  className,
  thumbLabel,
  thumbValueText,
  thumbClassName,
  rangeClassName,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-9 touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-full grow overflow-hidden rounded-full bg-control">
        <SliderPrimitive.Range
          className={cn("absolute h-full rounded-full bg-accent", rangeClassName)}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={thumbLabel}
        aria-valuetext={thumbValueText}
        className={cn(
          "block size-7 rounded-full bg-white shadow transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          thumbClassName,
        )}
      />
    </SliderPrimitive.Root>
  );
}
