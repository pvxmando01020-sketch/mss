'use client';

import { useState } from 'react';
import type { StoredMessage } from '@/lib/types';
import { isArabic, splitCode } from '@/lib/format';

interface Props {
  msg: StoredMessage;
  modelName?: string;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  t: Record<string, string>;
}

export function MessageBubble({ msg, modelName, isStreaming, onRegenerate, t }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const isUser = msg.role === 'user';
  const segments = splitCode(msg.content);

  const copy = (code: string, key: string) => {
    navigator.clipboard?.writeText(code).catch(() => undefined);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
  };

  return (
    <div className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm md:max-w-[78%] ${
          isUser
            ? 'bg-brand-600 text-white'
            : 'border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900'
        }`}
      >
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {msg.attachments.map((a, i) => (
              <img
                key={i}
                src={`/api/files/${a.fileKey}`}
                alt="attachment"
                className="max-h-56 max-w-full rounded-lg border border-ink-200 dark:border-ink-700"
              />
            ))}
          </div>
        )}
        {segments.map((s, i) =>
          s.type === 'code' ? (
            <div key={i} dir="ltr" className="my-2 overflow-hidden rounded-lg bg-ink-950 text-left">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
                <span className="text-[11px] text-ink-400">{s.lang ?? 'code'}</span>
                <button
                  onClick={() => copy(s.value, String(i))}
                  className="text-xs text-ink-300 hover:text-white"
                >
                  {copiedKey === String(i) ? '✓' : '⧉'}
                </button>
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-emerald-200">
                <code>{s.value}</code>
              </pre>
            </div>
          ) : (
            <span key={i} className="whitespace-pre-wrap" dir={isArabic(s.value) ? 'rtl' : 'ltr'}>
              {s.value}
            </span>
          ),
        )}
        {isStreaming && (
          <span className="ms-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-current align-text-bottom" />
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {!isUser && modelName && (
          <span className="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-[11px] text-ink-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-400">
            {modelName}
          </span>
        )}
        {!isUser && msg.status === 'aborted' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            ⏹ {t.stopped}
          </span>
        )}
        {!isUser && msg.status === 'partial' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            ⚠ {t.partialMsg}
          </span>
        )}
        {!isUser && !isStreaming && onRegenerate && (
          <button
            onClick={onRegenerate}
            className="text-xs text-ink-400 opacity-0 transition-opacity hover:text-brand-600 group-hover:opacity-100"
            title="regenerate"
          >
            ↻
          </button>
        )}
      </div>
    </div>
  );
}
