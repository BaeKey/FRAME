export function mediaStream(opts: { start: number; end: number; chunkSize: number; controller: AbortController; read: (offset: number, length: number) => Promise<Uint8Array>; onChunk?: (offset: number, length: number) => void; onError?: (err: Error) => void | Promise<void>; cleanup?: () => void }): ReadableStream<Uint8Array> {
  const { start, end, chunkSize, controller, read, onChunk = () => {}, onError = () => {}, cleanup = () => {} } = opts;
  let offset = start; let finished = false; let stream: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => { if (finished) return; finished = true; controller.signal.removeEventListener('abort', aborted); cleanup(); };
  const aborted = () => { if (finished) return; finish(); stream.error(new DOMException('Cancelled', 'AbortError')); };
  return new ReadableStream<Uint8Array>({
    start(value) { stream = value; if (controller.signal.aborted) aborted(); else controller.signal.addEventListener('abort', aborted, { once: true }); },
    async pull(value) {
      if (finished) return;
      try {
        const n = Math.min(chunkSize, end - offset + 1); const at = offset;
        const bytes = await read(at, n);
        if (finished || controller.signal.aborted) return;
        value.enqueue(bytes); offset += n; onChunk(at, n);
        if (offset > end) { finish(); value.close(); }
      } catch (cause) {
        if (finished) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const cancelled = controller.signal.aborted || error.name === 'AbortError';
        finish(); if (!controller.signal.aborted) controller.abort(); value.error(error);
        if (!cancelled) await onError(error);
      }
    },
    cancel() { finish(); controller.abort(); },
  }, { highWaterMark: 1 });
}
