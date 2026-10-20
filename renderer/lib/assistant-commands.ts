import type { AssistantPermission } from "@main/shared-types";

/** Starter prompts shared by the Assistant's empty-state chips and the matching slash commands. */
export const ASSISTANT_SUGGESTIONS = [
  "What should I focus on for the rest of today?",
  "Summarize the emails that need a reply",
  "When am I free tomorrow for an hour of deep work?",
  "What's overdue, and what could I drop?",
];

export type AssistantCommandName =
  | "new"
  | "history"
  | "model"
  | "effort"
  | "mode"
  | "attach"
  | "mcp"
  | "settings"
  | "focus"
  | "replies"
  | "free"
  | "overdue"
  | "brief"
  | "week";

/** Actions the Assistant view runs; the composer runs the others itself. */
export type AssistantViewAction = "new" | "history" | "mcp" | "settings";

export interface AssistantCommand {
  kind: "action" | "prompt";
  /** Typed after the slash. */
  name: AssistantCommandName;
  description: string;
  /** Usage hint for commands that take an argument. */
  argument?: string;
  /** Prompt commands only: the message they send. */
  prompt?: string;
}

export const ACTION_COMMANDS: AssistantCommand[] = [
  { kind: "action", name: "new", description: "Start a new chat" },
  { kind: "action", name: "history", description: "Open chat history" },
  { kind: "action", name: "model", description: "Open the model and effort panel" },
  {
    kind: "action",
    name: "effort",
    description: "Set reasoning effort, like /effort high",
    argument: "[level]",
  },
  {
    kind: "action",
    name: "mode",
    description: "Set permissions: read-only, ask or auto",
    argument: "[read-only|ask|auto]",
  },
  { kind: "action", name: "attach", description: "Add files or folders" },
  { kind: "action", name: "mcp", description: "Open MCP servers" },
  { kind: "action", name: "settings", description: "Open AI settings" },
];

function prompt(name: AssistantCommandName, text: string): AssistantCommand {
  return { kind: "prompt", name, description: text, prompt: text };
}

export const PROMPT_COMMANDS: AssistantCommand[] = [
  prompt("focus", ASSISTANT_SUGGESTIONS[0]),
  prompt("replies", ASSISTANT_SUGGESTIONS[1]),
  prompt("free", ASSISTANT_SUGGESTIONS[2]),
  prompt("overdue", ASSISTANT_SUGGESTIONS[3]),
  prompt(
    "brief",
    "Give me a short briefing for today: my meetings, what's due, and emails that need attention.",
  ),
  prompt("week", "Review my week: what got done, what slipped, and what to focus on next week."),
];

export interface CommandSection {
  title: "Actions" | "Prompts";
  commands: AssistantCommand[];
}

/** The command word and its argument when the text is a slash command; null otherwise. */
export function slashInput(text: string): { name: string; argument: string } | null {
  if (!text.startsWith("/") || text.includes("\n")) return null;
  const body = text.slice(1);
  const space = body.search(/\s/);
  if (space < 0) return { name: body.toLowerCase(), argument: "" };
  return { name: body.slice(0, space).toLowerCase(), argument: body.slice(space).trim() };
}

function rank(command: AssistantCommand, query: string): number {
  if (command.name === query) return 0;
  if (command.name.startsWith(query)) return 1;
  if (command.name.includes(query)) return 2;
  if (command.description.toLowerCase().includes(query)) return 3;
  return -1;
}

/**
 * Menu sections for the typed text: an exact name first, then name matches, then description
 * matches, in registry order within each. Once a space follows the command word, only that command
 * stays, and only if it takes an argument or none was typed. An empty result closes the menu.
 */
export function commandSections(text: string, options: { demo: boolean }): CommandSection[] {
  const input = slashInput(text);
  if (!input) return [];
  const withArgument = /\s/.test(text.slice(1));
  const pick = (commands: AssistantCommand[]) =>
    commands
      .filter((command) => !(options.demo && command.name === "attach"))
      .map((command, index) => ({
        command,
        index,
        rank: withArgument
          ? command.name === input.name && (command.argument || !input.argument)
            ? 0
            : -1
          : rank(command, input.name),
      }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.command);
  const sections: CommandSection[] = [
    { title: "Actions", commands: pick(ACTION_COMMANDS) },
    { title: "Prompts", commands: pick(PROMPT_COMMANDS) },
  ];
  return sections.filter((section) => section.commands.length > 0);
}

const MODES = new Map<string, AssistantPermission>([
  ["readonly", "read-only"],
  ["read", "read-only"],
  ["ask", "ask"],
  ["askfirst", "ask"],
  ["auto", "auto"],
]);

/** Reads a `/mode` argument: "read-only", "read only", "ask", "ask first" or "auto". */
export function parseModeArgument(text: string): AssistantPermission | null {
  return (
    MODES.get(
      text
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, ""),
    ) ?? null
  );
}
