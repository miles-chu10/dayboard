import { Field, FieldSet, Switch } from "@renderer/ui";
import { FOLLOW_UP_DAYS, UNDO_SEND_SECONDS, type UndoSendSeconds } from "@main/shared-types";

import { useSettingsEditor } from "../lib/settings";
import { SettingSelect } from "./setting-select";

const UNDO_OPTIONS = UNDO_SEND_SECONDS.map((seconds) => ({
  value: String(seconds),
  label: seconds ? `${seconds} seconds` : "Send right away",
}));

const FOLLOW_UP_OPTIONS = FOLLOW_UP_DAYS.map((days) => ({
  value: String(days),
  label: `${days} ${days === 1 ? "day" : "days"}`,
}));

export function MailSettings() {
  const { settings, edit } = useSettingsEditor();
  if (!settings) return null;
  const mail = settings.mail;
  return (
    <FieldSet title="Mail">
      <Field
        label="Triage new mail"
        description="Sort new mail into needs reply, FYI and ignorable as it arrives, with a one-line summary. Uses the AI provider in Settings → AI."
      >
        <Switch
          id="mail-auto-triage"
          aria-label="Triage new mail"
          checked={mail.autoTriage}
          onCheckedChange={(autoTriage) =>
            edit((draft) => {
              draft.mail.autoTriage = autoTriage;
            })
          }
        />
      </Field>
      <Field
        label="Undo send"
        description="How long a sent email waits before it goes, so you can stop it."
      >
        <SettingSelect
          label="Undo send"
          value={String(mail.undoSendSeconds)}
          options={UNDO_OPTIONS}
          onChange={(value) =>
            edit((draft) => {
              draft.mail.undoSendSeconds = Number(value) as UndoSendSeconds;
            })
          }
        />
      </Field>
      <Field
        label="Remind me if no reply"
        description="The default wait before an email you're waiting on comes back to Home."
      >
        <SettingSelect
          label="Remind me if no reply"
          value={String(mail.followUpDays)}
          options={FOLLOW_UP_OPTIONS}
          onChange={(value) =>
            edit((draft) => {
              draft.mail.followUpDays = Number(value);
            })
          }
        />
      </Field>
    </FieldSet>
  );
}
