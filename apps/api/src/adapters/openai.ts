import type { AdapterEvent, AdapterRequest, ModelAdapter, UnifiedMessage } from '../types';

interface ContentPart {
  type: string;
  [k: string]: unknown;
}

function toOpenAIMessages(req: AdapterRequest): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.attachments && m.attachments.length > 0) {
      const content: ContentPart[] = [{ type: 'text', text: m.content }];
      for (const a of m.attachments) {
        content.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      }
      out.push({ role: m.role, content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function createOpenAIAdapter(modelId: string, upstreamId: string, apiKey: string): ModelAdapter {
  return {
    id: modelId,
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<AdapterEvent> {
      let res: Response;
      try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: upstreamId,
            messages: toOpenAIMessages(req),
            stream: true,
            stream_options: { include_usage: true },
            ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          }),
        });
      } catch (err) {
        if (signal.aborted) return;
        yield { kind: 'error', code: 'UPSTREAM_ERROR', message: err instanceof Error ? err.message : 'network error', retryable: true };
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          yield { kind: 'error', code: 'MODEL_UNAVAILABLE', message: `openai rejected credentials (${res.status})`, retryable: false };
        } else {
          yield {
            kind: 'error',
            code: 'UPSTREAM_ERROR',
            message: `openai ${res.status}: ${body.slice(0, 200)}`,
            retryable: res.status === 429 || res.status >= 500,
          };
        }
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            let json: {
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              choices?: Array<{ delta?: { content?: string } }>;
            };
            try {
              json = JSON.parse(data);
            } catch {
              continue;
            }
            if (json.usage) {
              inputTokens = json.usage.prompt_tokens ?? inputTokens;
              outputTokens = json.usage.completion_tokens ?? outputTokens;
            }
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield { kind: 'delta', text: delta };
          }
        }
        yield { kind: 'done', usage: { inputTokens, outputTokens }, stopReason: 'end_turn' };
      } catch (err) {
        if (signal.aborted) return;
        yield { kind: 'error', code: 'UPSTREAM_ERROR', message: err instanceof Error ? err.message : 'stream error', retryable: true };
      }
    },
  };
}
