'use client';

import type { ConversationMeta } from '@/lib/types';

interface Props {
  conversations: ConversationMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  t: Record<string, string>;
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, t }: Props) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-e border-ink-200 bg-white md:flex dark:border-ink-800 dark:bg-ink-900">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          + {t.newChat}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          {t.history}
        </div>
        {conversations.length === 0 && (
          <div className="px-2 py-2 text-sm text-ink-400">{t.emptyHistory}</div>
        )}
        <ul className="space-y-0.5">
          {conversations.map((c) => (
            <li
              key={c.id}
              className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition-colors ${
                c.id === activeId
                  ? 'bg-brand-50 text-brand-700 dark:bg-ink-800 dark:text-brand-300'
                  : 'text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800/60'
              }`}
            >
              <button onClick={() => onSelect(c.id)} className="flex-1 truncate text-start">
                {c.title || t.newChat}
              </button>
              <button
                onClick={() => onDelete(c.id)}
                className="hidden text-ink-300 hover:text-red-500 group-hover:block"
                aria-label="delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
