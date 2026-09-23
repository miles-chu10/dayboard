import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/ui";

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
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="small" variant="transparent" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} sublabel={option.sublabel}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
