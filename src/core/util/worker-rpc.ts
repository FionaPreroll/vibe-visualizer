/**
 * Tiny request/response protocol between the main thread and a worker, with progress events and
 * transferable results. Enough for the spikes; P1 may replace it with Comlink.
 */

interface Request {
  id: number;
  method: string;
  args: unknown;
}

type Response =
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { id: number; progress: unknown };

const TRANSFER = Symbol('transfer');

interface WithTransfer<T> {
  [TRANSFER]: Transferable[];
  value: T;
}

/** Wraps a handler result whose buffers should be transferred instead of copied. */
export function withTransfer<T>(value: T, transfer: Transferable[]): WithTransfer<T> {
  return { [TRANSFER]: transfer, value };
}

type Handler = (args: never, progress: (update: unknown) => void) => unknown;

/** Worker side: answers requests with the given handlers. */
export function exposeWorker(handlers: Record<string, Handler>): void {
  self.addEventListener('message', (event: MessageEvent<Request>) => {
    const { id, method, args } = event.data;
    const handler = handlers[method];
    const progress = (update: unknown) =>
      self.postMessage({ id, progress: update } satisfies Response);
    Promise.resolve()
      .then(() => {
        if (!handler) throw new Error(`Unknown worker method: ${method}`);
        return handler(args as never, progress);
      })
      .then((result) => {
        if (result && typeof result === 'object' && TRANSFER in result) {
          const wrapped = result as WithTransfer<unknown>;
          self.postMessage({ id, result: wrapped.value } satisfies Response, {
            transfer: wrapped[TRANSFER],
          });
        } else {
          self.postMessage({ id, result } satisfies Response);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ id, error: message } satisfies Response);
      });
  });
}

/** Main-thread side: typed calls into a worker created with {@link exposeWorker}. */
export class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (u: unknown) => void }
  >();

  constructor(readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<Response>) => {
      const data = event.data;
      const entry = this.pending.get(data.id);
      if (!entry) return;
      if ('progress' in data) entry.progress?.(data.progress);
      else {
        this.pending.delete(data.id);
        if ('error' in data) entry.reject(new Error(data.error));
        else entry.resolve(data.result);
      }
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'Worker failed');
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    });
  }

  call<T>(
    method: string,
    args?: unknown,
    options: { transfer?: Transferable[]; onProgress?: (update: never) => void } = {},
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        progress: options.onProgress as ((u: unknown) => void) | undefined,
      });
      this.worker.postMessage({ id, method, args } satisfies Request, {
        transfer: options.transfer ?? [],
      });
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const entry of this.pending.values()) entry.reject(new Error('Worker terminated'));
    this.pending.clear();
  }
}
