import type {
  Conversation,
  ConversationMeta,
  MessagePayload,
  ModelInfo,
  SseEvent,
  SseEventName,
} from './types';
import { sessionHeaders } from './session';

export async function fetchModels(): Promise<{ models: ModelInfo[]; hasRealKeys: boolean }> {
  const res = await fetch('/api/models', { cache: 'no-store', headers: sessionHeaders() });
  if (!res.ok) throw new Error('failed to load models');
  const json = (await res.json()) as { models?: ModelInfo[] };
  const models = json.models ?? [];
  return {
    models,
    hasRealKeys: models.some((m) => m.available && m.provider !== 'mock'),
  };
}

export async function fetchConversations(): Promise<ConversationMeta[]> {
  const res = await fetch('/api/conversations', { cache: 'no-store', headers: sessionHeaders() });
  if (!res.ok) throw new Error('failed to load conversations');
  return (await res.json()) as ConversationMeta[];
}

export async function fetchConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store', headers: sessionHeaders() });
  if (!res.ok) throw new Error('failed to load conversation');
  return (await res.json()) as Conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}`, { method: 'DELETE', headers: sessionHeaders() });
}

/** Upload an image to S3 via the gateway; returns the stored object key. */
export async function uploadImage(file: File): Promise<{ key: string; mediaType: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', headers: sessionHeaders(), body: form });
  if (!res.ok) throw new Error('upload failed');
  return (await res.json()) as { key: string; mediaType: string };
}

export interface ChatPayload {
  conversationId: string | null;
  model: string;
  messages: MessagePayload[];
  /** false on regenerate — the history is already persisted server-side. */
  persist?: boolean;
}

/**
 * POST-based SSE consumer: fetch + ReadableStream (EventSource cannot POST).
 * Frames are separated by blank lines: `event: <name>\ndata: <json>\n\n`.
 */
export async function streamChat(
  payload: ChatPayload,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok || !res.body) {
    let code = 'INTERNAL';
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* body not json */
    }
    onEvent({ event: 'error', data: { code, message } });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let eventName: SseEventName | undefined;
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim() as SseEventName;
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!eventName || dataLines.length === 0) continue;
      try {
        onEvent({ event: eventName, data: JSON.parse(dataLines.join('\n')) });
      } catch {
        /* skip malformed frame */
      }
    }
  }
}
