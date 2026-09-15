'use client';

import { useRef, useState } from 'react';
import type { PendingAttachment } from '@/lib/types';
import { uploadImage } from '@/lib/api';

interface Props {
  t: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  attachment: PendingAttachment | null;
  onAttach: (a: PendingAttachment) => void;
  onRemoveAttachment: () => void;
}

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('unreadable file'));
    r.readAsDataURL(file);
  });
}

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
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) return;
    let previewUrl: string;
    try {
      previewUrl = await fileToDataUrl(file);
    } catch {
      return;
    }
    setUploading(true);
    try {
      // Preferred path: store in S3 first → the saved message renders the
      // stored object after a page reload.
      const { key } = await uploadImage(file);
      onAttach({ type: 'image', mediaType: file.type, previewUrl, fileKey: key });
    } catch {
      // Fallback: inline base64 in the chat body (works without object storage).
      onAttach({ type: 'image', mediaType: file.type, previewUrl, dataUrl: previewUrl });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-t border-ink-200 bg-white/80 p-3 backdrop-blur dark:border-ink-800 dark:bg-ink-950/80">
      {attachment && (
        <div className="mb-2 flex items-center gap-2">
          <img
            src={attachment.previewUrl}
            alt="attachment"
            className="h-14 w-14 rounded-lg object-cover"
          />
          <span className="text-xs text-ink-400">{attachment.mediaType}</span>
          <span className="text-[11px] text-ink-300">
            {attachment.fileKey ? 'S3 ✓' : 'inline'}
          </span>
          <button
            onClick={onRemoveAttachment}
            className="text-xs text-ink-500 hover:text-red-500"
          >
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
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          title={t.attach}
          className="btn-ghost !px-2.5 !py-2.5"
          disabled={streaming || uploading}
        >
          {uploading ? '…' : '🖼'}
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
