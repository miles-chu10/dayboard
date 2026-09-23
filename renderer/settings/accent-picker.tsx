import { Text } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import type { AccentColor } from "@main/shared-types";

import { ACCENT_OPTIONS } from "../lib/appearance";

const SYSTEM_SWATCH =
  "conic-gradient(#FF453A, #FF9F0A, #FFD60A, #30D158, #40C8E0, #0A84FF, #BF5AF2, #FF4F86, #FF453A)";

export function AccentPicker({
  value,
  onChange,
}: {
  value: AccentColor;
  onChange: (value: AccentColor) => void;
}) {
  const selected = ACCENT_OPTIONS.find((option) => option.value === value);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2">
        {ACCENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "size-5 rounded-full border border-separator outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
              option.value === value && "outline-2 outline-accent",
            )}
            style={{
              background: option.value === "system" ? SYSTEM_SWATCH : option.light,
            }}
          />
        ))}
      </div>
      <Text variant="small" color="secondary">
        {selected?.value === "system" ? "Matches your Mac" : selected?.label}
      </Text>
    </div>
  );
}
