import { useEffect, useRef, useState } from "react";
import type {
  AssistantChat,
  AssistantHistory,
  AssistantMessage,
} from "../../shared/assistant-history";
import { errorMessage, invoke } from "./ipc";

export function emptyChat(): AssistantChat {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function chatTitle(messages: AssistantMessage[]): string {
  return (
    messages
      .find((message) => message.role === "user")
      ?.content.trim()
      .replace(/\s+/g, " ")
      .slice(0, 100) || "New chat"
  );
}

export function sampleChat(): AssistantChat {
  const chat = emptyChat();
  return {
    ...chat,
    title: "Sample: Afternoon priorities",
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: "What should I focus on this afternoon?",
        tools: [],
        actions: [],
        error: null,
        blocked: null,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "**Sample conversation · fictional data**\n\nReview the launch announcement before the 3 PM roadmap sync. Priya’s unread email has the final-copy decision, and the onboarding pull request is the next unblocker.",
        tools: [],
        actions: [],
        error: null,
        blocked: null,
        provider: "glaze",
      },
    ],
  };
}

/** A session is remounted when the backend account changes; in-flight saves retain their original scope. */
export function useAssistantHistory(initial: AssistantHistory, demo: boolean) {
  const [history, setHistory] = useState(initial);
  const [chat, setChat] = useState(
    () =>
      initial.chats.find((item) => item.id === initial.activeChatId) ??
      (demo && !initial.chats.length ? sampleChat() : emptyChat()),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(demo && !initial.chats.length);
  const [switching, setSwitching] = useState(false);
  const chatRef = useRef(chat);
  const alive = useRef(true);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const enqueuedRevision = useRef(-1);
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const transitioning = useRef(false);

  function flush(): Promise<void> {
    const current = chatRef.current;
    const version = revision.current;
    if (!current.messages.length || version <= savedRevision.current) return saveTail.current;
    if (version === enqueuedRevision.current) return saveTail.current;
    enqueuedRevision.current = version;
    if (alive.current) setSaving(true);
    // Send immediately. The backend orders scope resolution, writes and reads,
    // and normal quit can see every submitted save rather than a renderer timer.
    const pending = invoke<AssistantHistory>("assistant:saveChat", {
      expectedScope: initial.scope,
      chat: current,
    })
      .then((result) => {
        savedRevision.current = version;
        if (alive.current) {
          setHistory(result);
          setSaveError(null);
        }
      })
      .catch((error: unknown) => {
        if (enqueuedRevision.current === version) enqueuedRevision.current = -1;
        if (alive.current) setSaveError(`Chat hasn’t been saved: ${errorMessage(error)}`);
        throw error;
      })
      .finally(() => {
        if (alive.current && revision.current === version) setSaving(false);
      });
    saveTail.current = pending;
    return pending;
  }

  function setMessages(
    update: AssistantMessage[] | ((previous: AssistantMessage[]) => AssistantMessage[]),
  ) {
    const previous = chatRef.current;
    const messages = typeof update === "function" ? update(previous.messages) : update;
    if (messages === previous.messages) return;
    const next = {
      ...previous,
      messages,
      title: chatTitle(messages),
      updatedAt: new Date().toISOString(),
    };
    chatRef.current = next;
    revision.current += 1;
    setChat(next);
    setSaving(true);
    void flush().catch(() => undefined);
  }

  useEffect(() => {
    alive.current = true;
    if (demo && !initial.chats.length) {
      revision.current += 1;
      void flush().catch(() => undefined);
    }
    return () => {
      alive.current = false;
      void flush().catch(() => undefined);
    };
  }, []);

  async function selectChat(id: string | null) {
    if (transitioning.current) return false;
    transitioning.current = true;
    setSwitching(true);
    try {
      await flush();
      if (!alive.current) return false;
      const result = await invoke<AssistantHistory>("assistant:selectChat", {
        expectedScope: initial.scope,
        id,
      });
      if (!alive.current) return false;
      const next = result.chats.find((item) => item.id === id) ?? emptyChat();
      chatRef.current = next;
      setChat(next);
      setHistory(result);
      revision.current = 0;
      savedRevision.current = 0;
      enqueuedRevision.current = -1;
      setSaveError(null);
      return true;
    } catch (error) {
      if (alive.current) setSaveError(`Couldn’t switch chats: ${errorMessage(error)}`);
      return false;
    } finally {
      transitioning.current = false;
      if (alive.current) setSwitching(false);
    }
  }

  async function importLegacy(messages: AssistantMessage[]) {
    if (transitioning.current) return false;
    transitioning.current = true;
    setSwitching(true);
    try {
      await flush();
      if (!alive.current) return false;
      const result = await invoke<AssistantHistory>("assistant:importLegacyChat", {
        expectedScope: initial.scope,
        messages,
      });
      if (!alive.current) return false;
      setHistory(result);
      const next = result.chats.find((item) => item.id === result.activeChatId) ?? emptyChat();
      chatRef.current = next;
      setChat(next);
      revision.current = 0;
      savedRevision.current = 0;
      enqueuedRevision.current = -1;
      setSaveError(null);
      return true;
    } catch (error) {
      if (alive.current) setSaveError(`Couldn’t import the previous chat: ${errorMessage(error)}`);
      return false;
    } finally {
      transitioning.current = false;
      if (alive.current) setSwitching(false);
    }
  }

  return {
    history,
    chat,
    messages: chat.messages,
    setMessages,
    flush,
    selectChat,
    importLegacy,
    saving,
    saveError,
    switching,
  };
}
