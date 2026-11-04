import { Button, Field, FieldSet, Switch, Text } from "@renderer/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SidebarView } from "@main/shared-types";

import { NAV_ITEMS } from "../lib/navigation";
import { sourceOn, useSettingsEditor } from "../lib/settings";

function title(id: SidebarView): string {
  return NAV_ITEMS.find((item) => item.id === id)?.title ?? id;
}

/** Settings → General → Sidebar: order, show or hide the main views, and their count pills. */
export function SidebarSettings() {
  const { settings, edit } = useSettingsEditor();
  if (!settings) return null;
  const { order, hidden, counts } = settings.general.sidebar;

  function move(id: SidebarView, delta: number) {
    edit((draft) => {
      const list = draft.general.sidebar.order;
      const from = list.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      list.splice(from, 1);
      list.splice(to, 0, id);
    });
  }

  function show(id: SidebarView, visible: boolean) {
    edit((draft) => {
      const rest = draft.general.sidebar.hidden.filter((item) => item !== id);
      draft.general.sidebar.hidden = visible ? rest : [...rest, id];
    });
  }

  return (
    <FieldSet
      title="Sidebar"
      description="Order the views and choose which appear. ⌃1–9 follow this order; hidden views stay in ⌘K."
    >
      <Field label="Show counts" orientation="horizontal">
        <Switch
          checked={counts}
          onCheckedChange={(checked) =>
            edit((draft) => {
              draft.general.sidebar.counts = checked;
            })
          }
          aria-label="Show counts"
        />
      </Field>
      <ul aria-label="Sidebar views" className="flex flex-col">
        {order.map((id, index) => {
          const name = title(id);
          const sourceOff =
            id !== "home" && id !== "agenda" && id !== "notes" && !sourceOn(settings, id);
          return (
            <li key={id}>
              <Field orientation="horizontal">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Text variant="regular">{name}</Text>
                  {sourceOff ? (
                    <Text variant="small" color="secondary">
                      Turned off in Sources
                    </Text>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    iconOnly
                    size="small"
                    variant="transparent"
                    aria-label={`Move ${name} up`}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    iconOnly
                    size="small"
                    variant="transparent"
                    aria-label={`Move ${name} down`}
                    disabled={index === order.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Switch
                    checked={!hidden.includes(id)}
                    disabled={id === "home"}
                    onCheckedChange={(visible) => show(id, visible)}
                    aria-label={`Show ${name}`}
                  />
                </div>
              </Field>
            </li>
          );
        })}
      </ul>
    </FieldSet>
  );
}
