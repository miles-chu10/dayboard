import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight, RotateCcw, Zap } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Slider,
  Text,
  ToggleButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@glaze/core/components";

import { ULTRA_WARNING, effortLabel, selectionLabel } from "../../shared/ai-effort";

export interface EffortPanelProps {
  modelLabel: string;
  /** Levels the model accepts, lowest first; empty when it has no effort control. */
  levels: string[];
  /** Shown in place of the slider when `levels` is empty. */
  note: string;
  /** The level shown; `explicit` is false while the model default applies. */
  selection: { level: string | null; explicit: boolean };
  /** Saves a level, or "" to return to the model default. */
  onChange: (level: string) => void;
  /** Present only where Fast mode exists. */
  fast: { on: boolean; onToggle: () => void } | null;
  /** Tooltip for the dimmed Ultra stop on routes that have a slider but no Ultra. */
  ultraNote: string | null;
  /** Items of the native provider and model menu that the model line opens. */
  modelMenu: ReactNode;
  /** The model, effort and Fast mode the next request uses. */
  nextRequest: string;
  /** What the chat's last reply recorded; null before any reply. */
  lastReply: string | null;
}

/** The Codex-style model and effort panel above the composer's model chip, on Glaze components. */
export function EffortPanel({
  modelLabel,
  levels,
  note,
  selection,
  onChange,
  fast,
  ultraNote,
  modelMenu,
  nextRequest,
  lastReply,
}: EffortPanelProps) {
  // With an unknown default the thumb rests on the middle stop, and a press there must still count.
  const movedRef = useRef(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const index = selection.level
    ? levels.indexOf(selection.level)
    : Math.floor((levels.length - 1) / 2);
  const label = selectionLabel(selection.level);

  // Glaze's Slider takes no thumb props, so name its thumb (role="slider") for VoiceOver here.
  useEffect(() => {
    const thumb = sliderRef.current?.querySelector('[role="slider"]');
    thumb?.setAttribute("aria-label", "Effort");
    thumb?.setAttribute("aria-valuetext", label);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1.75rem_1fr_1.75rem] items-center">
        {fast ? (
          <ToggleButton
            iconOnly
            size="small"
            variant="transparent"
            aria-label="Fast mode"
            pressed={fast.on}
            onPressedChange={() => fast.onToggle()}
          >
            <Zap className={fast.on ? "fill-current" : undefined} />
          </ToggleButton>
        ) : (
          <span />
        )}
        <Text variant="large-strong" color="accent" align="center">
          {levels.length ? label : ""}
        </Text>
        {levels.length ? (
          <Button
            iconOnly
            size="small"
            variant="transparent"
            aria-label="Reset effort to the model default"
            title="Use the model default"
            disabled={!selection.explicit}
            onClick={() => onChange("")}
          >
            <RotateCcw />
          </Button>
        ) : (
          <span />
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="small"
            variant="transparent"
            aria-label={`Change model: ${modelLabel}`}
            title={modelLabel}
            className="mx-auto max-w-full text-secondary"
          >
            <span className="truncate">{modelLabel}</span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top">{modelMenu}</DropdownMenuContent>
      </DropdownMenu>
      {levels.length > 1 ? (
        <div className="flex items-center gap-3">
          <div ref={sliderRef} className={selection.level ? "flex-1" : "flex-1 opacity-60"}>
            <Slider
              variant="filled"
              size="large"
              min={0}
              max={levels.length - 1}
              step={1}
              value={[index]}
              onPointerDown={() => {
                movedRef.current = false;
              }}
              onValueChange={([next]) => {
                movedRef.current = true;
                onChange(levels[next]);
              }}
              onPointerUp={() => {
                if (!movedRef.current && !selection.level) onChange(levels[index]);
              }}
            />
          </div>
          {ultraNote ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={`Ultra is not available for this model. ${ultraNote}`}
                  className="size-2 shrink-0 rounded-full bg-current text-tertiary opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] leading-snug">
                {ultraNote}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : (
        <Text variant="small" color="secondary" align="center">
          {levels.length === 1
            ? `${effortLabel(levels[0])} is the only effort for this model.`
            : note}
        </Text>
      )}
      {selection.level === "ultra" ? (
        <Text variant="small" color="secondary" align="center">
          {ULTRA_WARNING}
        </Text>
      ) : null}
      <div className="flex flex-col gap-0.5 border-t border-separator pt-2">
        <Text variant="small" color="secondary">
          Next request: {nextRequest}
        </Text>
        {lastReply ? (
          <Text variant="small" color="tertiary">
            Last reply: {lastReply}
          </Text>
        ) : null}
      </div>
    </div>
  );
}
