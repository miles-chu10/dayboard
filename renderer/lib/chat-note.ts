import type { AssistantMessage } from "@shared/assistant-history";

/** An Assistant chat as a markdown note: each turn under who said it, empty and failed turns left out. */
export function chatAsNote(
  title: string,
  messages: Pick<AssistantMessage, "role" | "content">[],
  savedAt: Date,
): { title: string; body: string } {
  const turns = messages
    .filter((message) => message.content.trim())
    .map(
      (message) =>
        `**${message.role === "user" ? "You" : "Assistant"}:** ${message.content.trim()}`,
    );
  const heading = title.trim() || "Assistant chat";
  const date = savedAt.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return {
    title: heading,
    body: [`# ${heading}`, `_Saved from the Assistant on ${date}._`, ...turns].join("\n\n"),
  };
}
