import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AIChat,
  Button,
  Callout,
  EmptyState,
  Markdown,
  ScrollArea,
  Text,
  toast,
} from "@glaze/core/components";
import { useGlazeAI } from "@glaze/core/hooks";
import { SquarePen } from "lucide-react";
import type { AIProvider, AIStreamChunk, AssistantResult } from "@main/shared-types";

import { ProviderMark, ProviderTile } from "../components/provider-logo";
import { ListCard } from "../components/section-card";
import { SourceDot } from "../components/source-dot";
import { BLOCKED_MESSAGE } from "../lib/ai";
import { buildAssistantSystem } from "../lib/ai-prompts";
import {
  ASSISTANT_SUGGESTIONS,
  loadConversation,
  saveConversation,
  splitActions,
  type AssistantAction,
  type AssistantMessage,
} from "../lib/assistant";
import { KIND_LABEL, KIND_SOURCE, createItem } from "../lib/create-items";
import { dayHeading, formatClock } from "../lib/dates";
import { errorMessage, openSettings } from "../lib/ipc";
import {
  useAccounts,
  useCalendar,
  useMail,
  useMcpServers,
  useReminders,
  useTasks,
} from "../lib/queries";
import { PROVIDER_LABEL, featureOn, sourceOn, useSettings } from "../lib/settings";
import { buildTodos } from "../lib/todos";
import { readTriageMap } from "../lib/triage";

function describeAction(action: AssistantAction): string {
  const time = action.time
    ? `${formatClock(action.time)}${action.endTime ? `–${formatClock(action.endTime)}` : ""}`
    : null;
  return [KIND_LABEL[action.kind], action.date ? dayHeading(action.date) : null, time]
    .filter(Boolean)
    .join(" · ");
}

function AssistantMessageView({
  message,
  provider,
  streaming,
  onAddAction,
  onEnableAI,
}: {
  message: AssistantMessage;
  provider: AIProvider;
  streaming: boolean;
  onAddAction: (index: number) => void;
  onEnableAI: () => void;
}) {
  if (message.role === "user") {
    return (
      <AIChat.Message.Root from="user">
        <AIChat.Message.Content>{message.content}</AIChat.Message.Content>
      </AIChat.Message.Root>
    );
  }

  const { body } = splitActions(message.content);
  const canEnable = message.blocked === "needs-consent" || message.blocked === "host-unavailable";
  const author = message.provider ?? provider;

  return (
    <AIChat.Message.Root from="assistant">
      <AIChat.Message.Content>
        <div className="flex items-center gap-1.5">
          <ProviderMark provider={author} className="size-4" />
          <Text variant="small-strong" color="secondary">
            {PROVIDER_LABEL[author]}
          </Text>
        </div>
        {message.tools.map((tool) => (
          <AIChat.Tool.Root key={tool.id} status={tool.status}>
            <AIChat.Tool.Trigger>
              <AIChat.Tool.Name>{tool.name}</AIChat.Tool.Name>
            </AIChat.Tool.Trigger>
          </AIChat.Tool.Root>
        ))}
        {body ? (
          <Markdown isStreaming={streaming}>{body}</Markdown>
        ) : streaming ? (
          <AIChat.Reasoning.Root status="streaming">
            <AIChat.Reasoning.Trigger>Thinking…</AIChat.Reasoning.Trigger>
          </AIChat.Reasoning.Root>
        ) : null}
        {message.actions.length ? (
          <ListCard>
            {message.actions.map((action, index) => (
              <div
                key={`${action.kind}-${index}`}
                className="flex items-center gap-3 px-3 py-2 min-w-0"
              >
                <SourceDot source={KIND_SOURCE[action.kind]} />
                <div className="flex flex-col min-w-0 flex-1">
                  <Text truncate>{action.title}</Text>
                  <Text variant="small" color="tertiary" truncate>
                    {describeAction(action)}
                  </Text>
                </div>
                <Button size="small" onClick={() => onAddAction(index)} disabled={action.added}>
                  {action.added ? "Added" : "Add"}
                </Button>
              </div>
            ))}
          </ListCard>
        ) : null}
        {message.error ? (
          <Callout
            color="orange"
            actions={
              canEnable ? (
                <Button size="small" onClick={onEnableAI}>
                  Allow AI
                </Button>
              ) : undefined
            }
          >
            {message.error}
          </Callout>
        ) : null}
      </AIChat.Message.Content>
    </AIChat.Message.Root>
  );
}

export function AssistantView() {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const enabled = featureOn(settings, "assistant");
  const provider = settings?.ai.provider ?? "glaze";
  const glazeAI = useGlazeAI();
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();
  const mcpServers = useMcpServers();

  const [messages, setMessages] = useState<AssistantMessage[]>(loadConversation);
  const [input, setInput] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const cancelRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const { prompt: handoffPrompt } = useSearch({ from: "/assistant" });
  const handledPromptRef = useRef<string | null>(null);

  const mcpCount = settings?.ai.useMcpInAssistant
    ? (mcpServers.data ?? []).filter((server) => server.enabled).length
    : 0;

  useEffect(() => {
    saveConversation(messages);
  }, [messages]);

  useEffect(
    () => () => {
      if (cancelRef.current) window.glazeAPI.glaze.ipc.cancelStream(cancelRef.current);
    },
    [],
  );

  // Questions typed on Today arrive as ?prompt=…; send each once, then clear it from the URL.
  useEffect(() => {
    if (!handoffPrompt) {
      handledPromptRef.current = null;
      return;
    }
    if (!settings || handledPromptRef.current === handoffPrompt) return;
    handledPromptRef.current = handoffPrompt;
    void navigate({ to: "/assistant", search: {}, replace: true });
    if (!enabled) return;
    if (runningId) setInput(handoffPrompt);
    else void send(handoffPrompt);
  }, [handoffPrompt, settings]);

  function patchMessage(id: string, update: (message: AssistantMessage) => AssistantMessage) {
    setMessages((previous) =>
      previous.map((message) => (message.id === id ? update(message) : message)),
    );
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || runningId) return;

    const userMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      tools: [],
      actions: [],
      error: null,
      blocked: null,
    };
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMessage]
      .filter((message) => message.content.trim())
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content:
          message.role === "assistant" ? splitActions(message.content).body : message.content,
      }));

    setMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        tools: [],
        actions: [],
        error: null,
        blocked: null,
        provider,
      },
    ]);
    setInput("");

    const googleConnected = accounts.data?.google.connected ?? false;
    const system = buildAssistantSystem({
      todos: buildTodos(tasks.data, reminders.data),
      todosAvailable: tasks.data?.state === "ok" || reminders.data?.state === "ok",
      calendar: calendar.data,
      mail: mail.data,
      triage: readTriageMap(),
      userEmail: accounts.data?.google.email ?? null,
      canCreate: {
        task: googleConnected && sourceOn(settings, "tasks"),
        reminder: accounts.data?.reminders === "full-access" && sourceOn(settings, "reminders"),
        event: googleConnected && sourceOn(settings, "calendar"),
      },
    });

    const cancellationId = crypto.randomUUID();
    cancelRef.current = cancellationId;
    setRunningId(assistantId);

    try {
      const result = await window.glazeAPI.glaze.ipc.stream<AIStreamChunk, AssistantResult>(
        "ai:assistant",
        { messages: history, system },
        (chunk) => {
          if (cancelRef.current !== cancellationId) return;
          if (chunk.type === "delta") {
            patchMessage(assistantId, (message) => ({
              ...message,
              content: message.content + chunk.text,
            }));
            return;
          }
          patchMessage(assistantId, (message) => {
            const existing = message.tools.some((tool) => tool.id === chunk.id);
            return {
              ...message,
              tools: existing
                ? message.tools.map((tool) =>
                    tool.id === chunk.id
                      ? { ...tool, status: chunk.status, name: chunk.name ?? tool.name }
                      : tool,
                  )
                : [
                    ...message.tools,
                    { id: chunk.id, name: chunk.name ?? "Tool", status: chunk.status },
                  ],
            };
          });
        },
        { cancellationId },
      );
      if (cancelRef.current !== cancellationId) return;
      if ("blocked" in result) {
        patchMessage(assistantId, (message) => ({
          ...message,
          error: BLOCKED_MESSAGE[result.blocked] ?? "AI is unavailable right now.",
          blocked: result.blocked,
        }));
      } else {
        patchMessage(assistantId, (message) => {
          const finalContent = message.content || result.text;
          return { ...message, content: finalContent, actions: splitActions(finalContent).actions };
        });
      }
    } catch (error) {
      if (cancelRef.current !== cancellationId) return;
      patchMessage(assistantId, (message) => ({
        ...message,
        error: errorMessage(error),
        tools: message.tools.map((tool) =>
          tool.status === "running" ? { ...tool, status: "error" } : tool,
        ),
      }));
    } finally {
      if (cancelRef.current === cancellationId) {
        cancelRef.current = null;
        setRunningId(null);
      }
    }
  }

  function stop() {
    if (!cancelRef.current) return;
    window.glazeAPI.glaze.ipc.cancelStream(cancelRef.current);
    cancelRef.current = null;
    const id = runningId;
    setRunningId(null);
    if (id) {
      patchMessage(id, (message) => ({
        ...message,
        content: message.content || "_Stopped._",
        tools: message.tools.map((tool) =>
          tool.status === "running" ? { ...tool, status: "error" } : tool,
        ),
      }));
    }
  }

  function newChat() {
    stop();
    setMessages([]);
  }

  async function addAction(messageId: string, index: number) {
    const action = messages.find((message) => message.id === messageId)?.actions[index];
    if (!action) return;
    try {
      await createItem(action, queryClient);
      patchMessage(messageId, (message) => ({
        ...message,
        actions: message.actions.map((item, itemIndex) =>
          itemIndex === index ? { ...item, added: true } : item,
        ),
      }));
      toast.success(`${KIND_LABEL[action.kind]} added: ${action.title}`);
    } catch (error) {
      toast.error(`Couldn't add ${KIND_LABEL[action.kind].toLowerCase()}: ${errorMessage(error)}`);
    }
  }

  const subtitle = enabled
    ? [
        PROVIDER_LABEL[provider],
        mcpCount ? `${mcpCount} MCP ${mcpCount === 1 ? "server" : "servers"}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <ScrollArea
      className="h-full"
      autoScrollToBottom
      showScrollToBottomButton
      title="Assistant"
      subtitle={subtitle}
      actions={
        <Button
          iconOnly
          aria-label="New chat"
          title="New chat"
          onClick={newChat}
          disabled={!messages.length}
        >
          <SquarePen />
        </Button>
      }
      footer={
        enabled ? (
          <div className="px-2 pb-2">
            <AIChat.Composer.Root
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
            >
              <AIChat.Composer.Surface>
                <AIChat.Composer.Row>
                  <AIChat.Composer.Input
                    value={input}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setInput(event.target.value)
                    }
                    placeholder={`Message ${PROVIDER_LABEL[provider]}…`}
                  />
                  <AIChat.Composer.Actions>
                    {runningId ? (
                      <AIChat.Composer.Submit action="stop" type="button" onClick={stop} />
                    ) : (
                      <AIChat.Composer.Submit action="send" disabled={!input.trim()} />
                    )}
                  </AIChat.Composer.Actions>
                </AIChat.Composer.Row>
              </AIChat.Composer.Surface>
            </AIChat.Composer.Root>
          </div>
        ) : undefined
      }
    >
      <AIChat.Conversation.Content>
        {!enabled ? (
          <EmptyState
            placement="viewport"
            title="Assistant Is Off"
            description="Turn on AI features and the Assistant in Settings → AI."
            actions={<Button onClick={() => void openSettings()}>Open Settings</Button>}
          />
        ) : messages.length === 0 ? (
          <EmptyState
            placement="viewport"
            media={<ProviderTile provider={provider} />}
            title="Ask About Your Day"
            description="The assistant sees your tasks, reminders, inbox, and calendar, and can suggest items for you to add."
            actions={ASSISTANT_SUGGESTIONS.map((suggestion) => (
              <Button key={suggestion} size="small" onClick={() => void send(suggestion)}>
                {suggestion}
              </Button>
            ))}
          />
        ) : (
          messages.map((message) => (
            <AssistantMessageView
              key={message.id}
              message={message}
              provider={provider}
              streaming={message.id === runningId}
              onAddAction={(index) => void addAction(message.id, index)}
              onEnableAI={() => void glazeAI.enableInHost()}
            />
          ))
        )}
        <AIChat.Conversation.Anchor />
      </AIChat.Conversation.Content>
    </ScrollArea>
  );
}
