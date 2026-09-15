'use client';

import { useRef } from 'react';
import type { AttachmentPayload } from '@/lib/types';

interface Props {
  t: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  attachment: AttachmentPayload | null;
  onAttach: (a: AttachmentPayload) => void;
  onRemoveAttachment: () => void;
}

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

export function Composer({
  t,
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  attachment,
  onAttach,
  onRemoveAttachment,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) return;
    const reader = new FileReader();
    reader.onload = () =>
      onAttach({ type: 'image', mediaType: file.type, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="border-t border-ink-200 bg-white/80 p-3 backdrop-blur dark:border-ink-800 dark:bg-ink-950/80">
      {attachment && (
        <div className="mb-2 flex items-center gap-2">
          <img src={attachment.dataUrl} alt="attachment" className="h-14 w-14 rounded-lg object-cover" />
          <span className="text-xs text-ink-400">{attachment.mediaType}</span>
          <button onClick={onRemoveAttachment} className="text-xs text-ink-500 hover:text-red-500">
            ✕ {t.removeAttach}
          </button>
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          title={t.attach}
          className="btn-ghost !px-2.5 !py-2.5"
          disabled={streaming}
        >
          🖼
        </button>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!streaming && value.trim()) onSend();
            }
          }}
          rows={Math.min(6, Math.max(1, value.split('\n').length))}
          placeholder={t.placeholder}
          className="input max-h-40 resize-none"
        />
        {streaming ? (
          <button onClick={onStop} className="btn bg-red-600 text-white hover:bg-red-700">
            ■ {t.stop}
          </button>
        ) : (
          <button onClick={onSend} disabled={!value.trim()} className="btn-primary">
            ✈ {t.send}
          </button>
        )}
      </div>
    </div>
  );
}
