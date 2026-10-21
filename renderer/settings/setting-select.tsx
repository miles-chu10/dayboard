import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/ui";

// Radix Select can't use an empty value, so "" (a provider's default) maps to a sentinel.
const EMPTY = "__default";

export function SettingSelect({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: string;
  options: { value: string; label: string; sublabel?: string }[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || EMPTY}
      onValueChange={(next) => onChange(next === EMPTY ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger size="small" variant="transparent" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY}
            value={option.value || EMPTY}
            sublabel={option.sublabel}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
