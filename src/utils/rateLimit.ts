import PQueue from 'p-queue';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(delay);
}

export function createRateLimiter(intervalCap: number, intervalMs: number): PQueue {
  return new PQueue({
    concurrency: 1,
    intervalCap,
    interval: intervalMs,
    carryoverConcurrencyCount: true
  });
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const queue = new PQueue({ concurrency: Math.max(1, concurrency) });

  return Promise.all(
    items.map((item, index) => queue.add(() => mapper(item, index)) as Promise<R>)
  );
}

export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  throw lastError;
}
