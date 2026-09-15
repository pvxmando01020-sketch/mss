import type { AdapterEvent, AdapterRequest, ModelAdapter, UnifiedMessage } from '../types';

interface AnthropicBlock {
  type: string;
  [k: string]: unknown;
}

function toAnthropicMessages(req: AdapterRequest): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.attachments && m.attachments.length > 0) {
      const blocks: AnthropicBlock[] = [{ type: 'text', text: m.content }];
      for (const a of m.attachments) {
        const b64 = a.dataUrl.split(',')[1] ?? '';
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: a.mediaType, data: b64 },
        });
      }
      out.push({ role: m.role, content: blocks });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function createAnthropicAdapter(modelId: string, upstreamId: string, apiKey: string): ModelAdapter {
  return {
    id: modelId,
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<AdapterEvent> {
      let res: Response;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: upstreamId,
            max_tokens: req.maxTokens ?? 2048,
            ...(req.system ? { system: req.system } : {}),
            stream: true,
            messages: toAnthropicMessages(req),
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
          yield { kind: 'error', code: 'MODEL_UNAVAILABLE', message: `anthropic rejected credentials (${res.status})`, retryable: false };
        } else {
          yield {
            kind: 'error',
            code: 'UPSTREAM_ERROR',
            message: `anthropic ${res.status}: ${body.slice(0, 200)}`,
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
      let stopReason = 'end_turn';

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
            if (!data) continue;
            let json: {
              type?: string;
              message?: { usage?: { input_tokens?: number } };
              delta?: { text_delta?: { text?: string } };
              usage?: { output_tokens?: number };
              stop_reason?: string;
            };
            try {
              json = JSON.parse(data);
            } catch {
              continue;
            }
            if (json.type === 'message_start' && json.message?.usage) {
              inputTokens = json.message.usage.input_tokens ?? 0;
            } else if (json.type === 'content_block_delta') {
              const t = json.delta?.text_delta?.text;
              if (t) yield { kind: 'delta', text: t };
            } else if (json.type === 'message_delta') {
              if (json.usage?.output_tokens != null) outputTokens = json.usage.output_tokens;
              if (json.stop_reason) stopReason = json.stop_reason;
            }
          }
        }
        yield { kind: 'done', usage: { inputTokens, outputTokens }, stopReason };
      } catch (err) {
        if (signal.aborted) return;
        yield { kind: 'error', code: 'UPSTREAM_ERROR', message: err instanceof Error ? err.message : 'stream error', retryable: true };
      }
    },
  };
}
