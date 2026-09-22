import { useEffect, useRef, useState } from "react";
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
import { History, SquarePen } from "lucide-react";
import type {
  AIProvider,
  AIStreamChunk,
  AssistantAttachment,
  AssistantModelInfo,
  AssistantResult,
} from "@main/shared-types";
import type { AssistantHistory } from "../../shared/assistant-history";

import { AssistantComposer, type ContextUsage } from "../components/assistant-composer";
import { HistoryNav } from "../components/history-nav";
import { ProviderMark, ProviderTile } from "../components/provider-logo";
import { ListCard } from "../components/section-card";
import { SourceDot } from "../components/source-dot";
import { ChatHistoryDialog } from "../components/chat-history-dialog";
import { BLOCKED_MESSAGE } from "../lib/ai";
import { selectedModel, useCodexModels } from "../lib/ai-models";
import { isRendererDemoMode } from "../lib/demo";
import { buildAssistantSystem } from "../lib/ai-prompts";
import {
  ASSISTANT_SUGGESTIONS,
  loadLegacyConversation,
  splitActions,
  type AssistantAction,
  type AssistantMessage,
} from "../lib/assistant";
import { KIND_LABEL, KIND_SOURCE, createItem } from "../lib/create-items";
import { dayHeading, formatClock } from "../lib/dates";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { useAssistantHistory } from "../lib/assistant-history";
import { drainAssistantOperations, trackAssistantOperation } from "../lib/assistant-operations";
import {
  useAccounts,
  useCalendar,
  useMail,
  useAssistantMcpStatus,
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

function modelLabel(model: AssistantModelInfo): string {
  return [
    model.name,
    model.id && model.id !== model.name ? model.id : null,
    model.fast ? "Fast" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function AssistantMessageView({
  message,
  provider,
  streaming,
  onAddAction,
  onEnableAI,
  demo,
  adding,
}: {
  message: AssistantMessage;
  provider: AIProvider;
  streaming: boolean;
  onAddAction: (index: number) => void;
  onEnableAI: () => void;
  demo: boolean;
  adding: boolean;
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
          {message.modelLabel ? (
            <Text variant="small" color="tertiary" truncate>
              {message.modelLabel}
            </Text>
          ) : null}
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
                <Button
                  size="small"
                  onClick={() => onAddAction(index)}
                  disabled={action.added || demo || adding}
                >
                  {action.added ? "Added" : demo ? "Sample" : "Add"}
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
  const [state, setState] = useState<{
    history?: AssistantHistory;
    error?: string;
    generation: number;
  }>({ generation: 0 });
  const loadVersion = useRef(0);
  const loadRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    let mounted = true;
    const load = () => {
      const generation = ++loadVersion.current;
      setState({ generation });
      void drainAssistantOperations()
        .then(() => invoke<AssistantHistory>("assistant:getHistory"))
        .then((history) => {
          if (mounted && loadVersion.current === generation) setState({ history, generation });
        })
        .catch((error: unknown) => {
          if (mounted && loadVersion.current === generation)
            setState({ error: errorMessage(error), generation });
        });
    };
    loadRef.current = load;
    load();
    const unsubscribe = window.glazeAPI.glaze.ipc.onNotification("accounts:changed", load);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  if (!state.history)
    return (
      <ScrollArea title="Assistant" className="h-full">
        <EmptyState
          placement="viewport"
          title={state.error ? "Chat history unavailable" : "Loading chats…"}
          description={state.error}
          actions={
            state.error ? <Button onClick={() => loadRef.current()}>Try Again</Button> : undefined
          }
        />
      </ScrollArea>
    );
  return (
    <AssistantSession
      key={`${state.history.scope}:${state.generation}`}
      initialHistory={state.history}
    />
  );
}

function AssistantSession({ initialHistory }: { initialHistory: AssistantHistory }) {
  const demo = isRendererDemoMode();
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
  const mcpStatus = useAssistantMcpStatus();
  const model = selectedModel(settings, useCodexModels(provider === "codex").data);

  const history = useAssistantHistory(initialHistory, demo);
  const { messages, setMessages } = history;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [legacyMessages] = useState(() =>
    demo || initialHistory.legacyImported ? [] : loadLegacyConversation(),
  );
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const cancelRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const { prompt: handoffPrompt } = useSearch({ from: "/assistant" });
  const handledPromptRef = useRef<string | null>(null);

  const mcpCount = settings?.ai.useMcpInAssistant ? (mcpStatus.data?.serverCount ?? 0) : 0;

  useEffect(
    () => () => {
      if (cancelRef.current) window.glazeAPI.glaze.ipc.cancelStream(cancelRef.current);
      cancelRef.current = null;
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
      previous.some((message) => message.id === id)
        ? previous.map((message) => (message.id === id ? update(message) : message))
        : previous,
    );
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || cancelRef.current || history.switching || !enabled) return;

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
    const requestMessages = [...messages, userMessage]
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
    const sentAttachments = attachments;
    setAttachments([]);
    const permission = settings?.ai.assistantPermission ?? "ask";

    const googleConnected = accounts.data?.google.connected ?? false;
    const system = buildAssistantSystem({
      todos: buildTodos(tasks.data, reminders.data),
      todosAvailable: tasks.data?.state === "ok" || reminders.data?.state === "ok",
      calendar: calendar.data,
      mail: mail.data,
      triage: readTriageMap(),
      userEmail: accounts.data?.google.email ?? null,
      permission,
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
      await history.flush();
      if (cancelRef.current !== cancellationId) return;
      const result = await window.glazeAPI.glaze.ipc.stream<AIStreamChunk, AssistantResult>(
        "ai:assistant",
        { messages: requestMessages, system, attachments: sentAttachments.map((item) => item.id) },
        (chunk) => {
          if (cancelRef.current !== cancellationId) return;
          if (chunk.type === "meta") {
            patchMessage(assistantId, (message) => ({
              ...message,
              modelLabel: modelLabel(chunk.model),
            }));
            return;
          }
          if (chunk.type === "usage") {
            setUsage({ inputTokens: chunk.inputTokens, contextWindow: chunk.contextWindow });
            return;
          }
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
        let proposed = 0;
        patchMessage(assistantId, (message) => {
          const finalContent = message.content || result.text;
          const actions = permission === "read-only" ? [] : splitActions(finalContent).actions;
          proposed = actions.length;
          return { ...message, content: finalContent, actions };
        });
        if (permission === "auto" && proposed) autoAddRef.current = assistantId;
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
        void history.flush().catch(() => undefined);
      }
    }
  }

  // Auto permission: add every proposed item once the reply has settled.
  const autoAddRef = useRef<string | null>(null);
  useEffect(() => {
    const id = autoAddRef.current;
    if (!id || runningId) return;
    const message = messages.find((item) => item.id === id);
    if (!message) return;
    autoAddRef.current = null;
    void (async () => {
      for (let index = 0; index < message.actions.length; index++) {
        if (!message.actions[index].added) await addAction(id, index);
      }
    })();
  }, [messages, runningId]);

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

  async function newChat() {
    if (addingRef.current) return;
    stop();
    if (await history.selectChat(null)) {
      setInput("");
      setAttachments([]);
      setUsage(null);
    }
  }

  async function openChat(id: string) {
    if (addingRef.current) return;
    stop();
    if (await history.selectChat(id)) {
      setInput("");
      setUsage(null);
      setHistoryOpen(false);
    }
  }

  async function addAction(messageId: string, index: number) {
    if (demo || addingRef.current || history.switching) return;
    const action = messages.find((message) => message.id === messageId)?.actions[index];
    if (!action) return;
    addingRef.current = true;
    setAdding(true);
    try {
      await trackAssistantOperation(async () => {
        await createItem(action, queryClient);
        patchMessage(messageId, (message) => ({
          ...message,
          actions: message.actions.map((item, itemIndex) =>
            itemIndex === index ? { ...item, added: true } : item,
          ),
        }));
        try {
          await history.flush();
        } catch {
          toast.error(
            "The item was created, but its chat status couldn’t be saved. Don’t add it again.",
          );
          return;
        }
        toast.success(`${KIND_LABEL[action.kind]} added: ${action.title}`);
      });
    } catch (error) {
      toast.error(`Couldn't add ${KIND_LABEL[action.kind].toLowerCase()}: ${errorMessage(error)}`);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  const subtitle = enabled
    ? [
        provider === "glaze"
          ? PROVIDER_LABEL[provider]
          : `${PROVIDER_LABEL[provider]} · ${model.label}${model.fast ? " · Fast" : ""}`,
        demo ? "Sample data" : null,
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
      title={messages.length ? history.chat.title : "Assistant"}
      subtitle={subtitle}
      actions={
        <>
          <HistoryNav />
          <Button
            iconOnly
            aria-label="Chat history"
            title="Chat history"
            onClick={() => setHistoryOpen(true)}
            disabled={history.switching || adding}
          >
            <History />
          </Button>
          <Button
            iconOnly
            aria-label="New chat"
            title="New chat"
            onClick={() => void newChat()}
            disabled={!messages.length || history.switching || adding}
          >
            <SquarePen />
          </Button>
        </>
      }
      footer={
        enabled ? (
          <div className="px-2 pb-2 space-y-2">
            {history.saveError ? (
              <Callout
                color="orange"
                actions={
                  <Button size="small" onClick={() => void history.flush().catch(() => undefined)}>
                    Retry Save
                  </Button>
                }
              >
                {history.saveError}
              </Callout>
            ) : null}
            <div role="status" className="h-4 px-3">
              <Text variant="small" color="secondary">
                {history.saveError
                  ? "Not saved"
                  : messages.length
                    ? history.saving
                      ? "Saving chat…"
                      : "Saved on this Mac"
                    : "\u00a0"}
              </Text>
            </div>
            <AssistantComposer
              input={input}
              setInput={setInput}
              attachments={attachments}
              setAttachments={setAttachments}
              onSend={() => void send(input)}
              onStop={stop}
              running={Boolean(runningId)}
              disabled={history.switching}
              usage={usage}
              demo={demo}
            />
          </div>
        ) : undefined
      }
    >
      <ChatHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        chats={history.history.chats}
        activeId={history.chat.id}
        busy={history.switching || adding}
        onSelect={openChat}
      />
      <AIChat.Conversation.Content>
        {legacyMessages.length && !history.history.legacyImported ? (
          <Callout
            actions={
              <Button
                size="small"
                disabled={Boolean(runningId) || history.switching || adding}
                onClick={() => void history.importLegacy(legacyMessages)}
              >
                Import Previous Chat
              </Button>
            }
          >
            A previous local conversation is available to save in this account’s history.
          </Callout>
        ) : null}
        {!enabled && !messages.length ? (
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
              onEnableAI={() => {
                if (!demo) void glazeAI.enableInHost();
              }}
              demo={demo}
              adding={adding}
            />
          ))
        )}
        <AIChat.Conversation.Anchor />
      </AIChat.Conversation.Content>
    </ScrollArea>
  );
}
