// 音频缓存：内存层（同步命中，给 iOS 用）+ IndexedDB（跨刷新持久化）
//
// 为什么需要内存层：iOS Safari 要求 play() 在用户点击的同步调用栈里执行，
// 一旦 await 网络，播放会被系统拒绝。所以要在用户点之前就把音频备好。

const DB_NAME = "english-tts";
const STORE = "audio";

const memory = new Map<string, Blob>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 同步读取内存层（点击时用，必须是同步的） */
export function memoryGet(key: string): Blob | undefined {
  return memory.get(key);
}

export function memorySet(key: string, blob: Blob) {
  memory.set(key, blob);
}

export async function cacheGet(key: string): Promise<Blob | null> {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as Blob) ?? null);
      request.onerror = () => resolve(null);
    });
    if (blob) memory.set(key, blob);
    return blob;
  } catch {
    return null;
  }
}

export async function cachePut(key: string, blob: Blob): Promise<void> {
  memory.set(key, blob);
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(blob, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    /* 缓存失败不影响使用 */
  }
}

/** 预取一批文本的模型音频（并发受控），用于点击前备好 */
export async function prefetchAudio(
  texts: string[],
  options: { concurrency?: number; onDone?: (loaded: number, total: number) => void } = {}
): Promise<number> {
  const concurrency = options.concurrency ?? 3;
  const unique = Array.from(new Set(texts.map((t) => t.trim()).filter(Boolean)));
  let loaded = 0;
  let index = 0;

  const worker = async () => {
    while (index < unique.length) {
      const text = unique[index];
      index += 1;
      if (memory.has(text)) {
        loaded += 1;
        options.onDone?.(loaded, unique.length);
        continue;
      }
      try {
        const cached = await cacheGet(text);
        if (cached) {
          loaded += 1;
          options.onDone?.(loaded, unique.length);
          continue;
        }
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(20000),
        });
        if (response.ok && response.headers.get("content-type")?.startsWith("audio/")) {
          const blob = await response.blob();
          if (blob.size) await cachePut(text, blob);
        }
      } catch {
        /* 单条失败不影响其他 */
      }
      loaded += 1;
      options.onDone?.(loaded, unique.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return loaded;
}
