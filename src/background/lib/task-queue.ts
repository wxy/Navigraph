/** One ordering boundary for browser events, settings, messages and destructive actions. */
let resolveReady: () => void;
let rejectReady: (error: unknown) => void;
const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
let tail: Promise<unknown> = ready;
let afterTask: (() => Promise<void>) | undefined;
export function backgroundReady(hook: () => Promise<void>): void { afterTask = hook; resolveReady(); }
export function backgroundFailed(error: unknown): void { rejectReady(error); }
export function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
  const result = tail.then(async () => { await ready; return task(); });
  tail = result.then(async () => { try { await afterTask?.(); } catch (error) { console.error('Background checkpoint failed', error); } }, error => { console.error('Background task failed', error); });
  return result;
}
