import type { ServerResponse } from 'node:http';
import type { SseEvent } from './types';

export function sseHeaders(raw: ServerResponse): void {
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  raw.write(': connected\n\n');
}

export function writeSse(raw: ServerResponse, event: SseEvent): void {
  raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}
