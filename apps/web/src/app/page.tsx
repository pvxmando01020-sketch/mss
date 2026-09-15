'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { MessageBubble } from '@/components/MessageBubble';
import { Composer } from '@/components/Composer';
import {
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchModels,
  streamChat,
} from '@/lib/api';
import type {
  ConversationMeta,
  MessagePayload,
  ModelInfo,
  PendingAttachment,
  StoredMessage,
} from '@/lib/types';
import { translate, type Lang } from '@/lib/i18n';

const HISTORY_LIMIT = 20;

export default function ChatPage() {
  const [lang, setLang] = useState<Lang>('ar');
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [usedModel, setUsedModel] = useState('');
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{ display: StoredMessage[]; payload: MessagePayload[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = translate(lang);

  // Initial data load.
  useEffect(() => {
    (async () => {
      try {
        const { models: m, hasRealKeys } = await fetchModels();
        setModels(m);
        if (!hasRealKeys) setNotice(translate(lang).demoNotice);
        setConversations(await fetchConversations());
      } catch {
        /* API offline — UI remains usable */
      }
    })();
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to the latest content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, streamText]);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await fetchConversations());
    } catch {
      /* ignore */
    }
  }, []);

  const modelNameFor = useCallback(
    (id?: string) => {
      if (!id) return undefined;
      if (id === 'auto') return `✨ ${t.auto}`;
      return models.find((m) => m.id === id)?.name ?? id;
    },
    [models, t],
  );

  const selectConversation = useCallback(
    async (id: string) => {
      if (streaming) return;
      try {
        const c = await fetchConversation(id);
        setActiveId(id);
        setMessages(c.messages);
        setError(null);
      } catch {
        /* ignore */
      }
    },
    [streaming],
  );

  const newChat = useCallback(() => {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
  }, [streaming]);

  const removeConversation = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(id);
        if (id === activeId) {
          setActiveId(null);
          setMessages([]);
        }
        await refreshConversations();
      } catch {
        /* ignore */
      }
    },
    [activeId, refreshConversations],
  );

  /** Core streaming run: display is what to render, payload is what to send. */
  const runChat = useCallback(
    async (display: StoredMessage[], payloadMessages: MessagePayload[], persist = true) => {
      const controller = new AbortController();
      abortRef.current = controller;
      lastRunRef.current = { display, payload: payloadMessages };
      setStreaming(true);
      setStreamText('');
      setError(null);
      setUsedModel(selectedModel);
      let acc = '';
      let used = selectedModel;
      let convId = activeId;
      let doneReason = '';
      let failed = false;

      try {
        await streamChat(
          { conversationId: convId, model: selectedModel, messages: payloadMessages, persist },
          (e) => {
            const d = e.data as Record<string, unknown>;
            if (e.event === 'start') {
              used = String(d.model ?? used);
              setUsedModel(used);
              if (d.fallbackFrom) setNotice(`${t.fallbackNotice} ${used}`);
              if (Array.isArray(d.warnings) && d.warnings.length > 0) setNotice(t.moderationNotice);
              if (!convId) {
                convId = String(d.conversationId);
                setActiveId(convId);
              }
            } else if (e.event === 'delta') {
              acc += String(d.text ?? '');
              setStreamText(acc);
            } else if (e.event === 'fallback') {
              setNotice(`${t.fallbackNotice} ${String(d.to)}`);
            } else if (e.event === 'done') {
              doneReason = String(d.stopReason ?? '');
            } else if (e.event === 'error') {
              failed = true;
              setError(`${String(d.code)}: ${String(d.message)}`);
            }
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError(String(err));
      } finally {
        const finalContent = acc;
        const status: 'complete' | 'partial' | 'aborted' = failed
          ? 'partial'
          : doneReason === 'aborted'
            ? 'aborted'
            : 'complete';
        setMessages((prev) =>
          finalContent.length > 0
            ? [
                ...prev,
                {
                  id: `a-${Date.now()}`,
                  role: 'assistant' as const,
                  content: finalContent,
                  model: used,
                  status,
                  createdAt: Date.now(),
                },
              ]
            : prev,
        );
        setStreamText('');
        setStreaming(false);
        abortRef.current = null;
        void refreshConversations();
      }
    },
    [activeId, selectedModel, t, refreshConversations],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg: StoredMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    const display = [...messages, userMsg];
    const history = messages.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const att = attachment
      ? attachment.fileKey
        ? { type: 'image' as const, mediaType: attachment.mediaType, fileKey: attachment.fileKey }
        : { type: 'image' as const, mediaType: attachment.mediaType, dataUrl: attachment.dataUrl }
      : undefined;
    const payload: MessagePayload[] = [
      ...history,
      {
        role: 'user',
        content: text,
        ...(att ? { attachments: [att] } : {}),
      },
    ];
    setInput('');
    setAttachment(null);
    void runChat(display, payload);
  }, [input, streaming, messages, attachment, runChat]);

  const regenerate = useCallback(() => {
    if (streaming) return;
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant === -1) return;
    const display = messages.slice(0, lastAssistant);
    if (display.length === 0) return;
    const payload = display.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    // The history (incl. the last user message) is already persisted → persist: false
    void runChat(display, payload, false);
  }, [streaming, messages, runChat]);

  const retry = useCallback(() => {
    const last = lastRunRef.current;
    if (!last || streaming) return;
    setError(null);
    void runChat(last.display, last.payload);
  }, [runChat, streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('mss-theme', next);
  };

  const toggleLang = () => {
    const next: Lang = lang === 'ar' ? 'en' : 'ar';
    setLang(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('mss-lang', next);
  };

  const suggestions = [t.s1, t.s2, t.s3];

  return (
    <div className="flex h-screen">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => void selectConversation(id)}
        onNew={newChat}
        onDelete={(id) => void removeConversation(id)}
        t={t}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ink-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-ink-800 dark:bg-ink-950/80">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-base font-bold text-white">
              M
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">{t.appName}</div>
              <div className="text-[11px] text-ink-400">{t.tagline}</div>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="input !w-auto !py-1.5 text-sm"
              disabled={streaming}
            >
              <option value="auto">✨ {t.auto}</option>
              {models
                .filter((m) => m.available)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <button onClick={toggleTheme} title={t.themeToggle} className="btn-ghost !px-2.5">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={toggleLang} className="btn-ghost !px-2.5 text-xs font-bold">
              {t.langLabel}
            </button>
          </div>
        </header>

        {notice && (
          <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:border-brand-900 dark:bg-brand-900/20 dark:text-brand-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="dismiss">
              ✕
            </button>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <span className="truncate" dir="ltr">
              {error}
            </span>
            <div className="flex shrink-0 gap-3">
              <button onClick={retry} className="font-medium underline">
                {t.retry}
              </button>
              <button onClick={() => setError(null)} aria-label="dismiss">
                ✕
              </button>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 md:px-8">
          {messages.length === 0 && !streaming ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="text-4xl">💬</div>
              <h1 className="text-xl font-bold">{t.welcomeTitle}</h1>
              <p className="max-w-md text-sm leading-relaxed text-ink-500">{t.welcomeText}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-xl border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-600 transition-colors hover:border-brand-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  modelName={modelNameFor(m.model)}
                  onRegenerate={i === messages.length - 1 ? regenerate : undefined}
                  t={t}
                />
              ))}
              {streaming && (
                <MessageBubble
                  msg={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamText,
                    model: usedModel,
                    createdAt: Date.now(),
                  }}
                  modelName={modelNameFor(usedModel)}
                  isStreaming
                  t={t}
                />
              )}
            </div>
          )}
        </div>

        <Composer
          t={t}
          value={input}
          onChange={setInput}
          onSend={send}
          onStop={stop}
          streaming={streaming}
          attachment={attachment}
          onAttach={setAttachment}
          onRemoveAttachment={() => setAttachment(null)}
        />
      </main>
    </div>
  );
}
