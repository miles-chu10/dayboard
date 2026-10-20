import { useRef, useState } from "react";
import { Input } from "@renderer/ui";

import { hidePanel, useFitPanelHeight, usePanelShown } from "./panel-ipc";

export function CapturePanel() {
  const container = useFitPanelHeight<HTMLDivElement>("capture");
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  usePanelShown(() => input.current?.focus());

  return (
    <div ref={container} className="flex flex-col gap-2 p-3">
      <Input
        ref={input}
        autoFocus
        aria-label="Quick Capture"
        className="h-10 text-[15px]"
        placeholder="Add a task, reminder or event — e.g. Call dentist Thursday 3pm"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            void hidePanel("capture");
          }
        }}
      />
    </div>
  );
}
