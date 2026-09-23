import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "./utils";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentProps<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-regular text-primary select-none",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-40",
      "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-40",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
