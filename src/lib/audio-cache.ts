// 音频缓存：内存层（同步命中，给 iOS 用）+ IndexedDB（跨刷新持久化）
//
// 为什么需要内存层：iOS Safari 要求 play() 在用户点击的同步调用栈里执行，
// 一旦 await 网络，播放会被系统拒绝。所以要在用户点之前就把音频备好。
//
// 存储策略：只保留「当天要学的」和「第二天」的音频，历史音频一律不留。

const DB_NAME = "english-tts";
const STORE = "audio";

const memory = new Map<string, Blob>();

/** 语速不同则音频不同，缓存键必须带语速 */
// 音色/语速变化后旧音频必须失效：把版本号与语速一起写进缓存键
const AUDIO_CACHE_VERSION = "v2";

export function audioKey(text: string, speed: number, hint = ""): string {
  return `${AUDIO_CACHE_VERSION}|${speed.toFixed(2)}|${hint}|${text.trim()}`;
}

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

/** 删除不在保留清单里的音频（历史音频不保存） */
export async function pruneAudioCache(
  keepItems: (string | SpeakTarget)[],
  speed: number
): Promise<number> {
  // 同一段文本可能同时以「无音标」和「带音标」两种键缓存，两个键都保留
  const keep = new Set<string>();
  for (const item of keepItems) {
    const target = typeof item === "string" ? { text: item, phonetic: "" } : item;
    keep.add(audioKey(target.text, speed, ""));
    if (target.phonetic) keep.add(audioKey(target.text, speed, target.phonetic));
  }
  // 语速变了，旧语速的音频也不再需要
  for (const key of Array.from(memory.keys())) {
    if (!keep.has(key)) memory.delete(key);
  }
  try {
    const db = await openDb();
    const keys = await new Promise<string[]>((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve((request.result as string[]) ?? []);
      request.onerror = () => resolve([]);
    });
    const stale = keys.filter((key) => !keep.has(key));
    if (!stale.length) return 0;
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const key of stale) store.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
    return stale.length;
  } catch {
    return 0;
  }
}

/** 预取一批文本的模型音频（并发受控），用于点击前备好 */
export type SpeakTarget = { text: string; phonetic?: string };

export async function prefetchAudio(
  texts: (string | SpeakTarget)[],
  options: { concurrency?: number; speed?: number; onDone?: (loaded: number, total: number) => void } = {}
): Promise<number> {
  const concurrency = options.concurrency ?? 4;
  const speed = options.speed ?? 1;
  const unique = Array.from(
    new Map(
      texts
        .map((t) => (typeof t === "string" ? { text: t, phonetic: "" } : { text: t.text, phonetic: t.phonetic || "" }))
        .filter((t) => t.text.trim())
        .map((t) => [audioKey(t.text, speed, t.phonetic), t] as const)
    ).values()
  );
  let loaded = 0;
  let index = 0;

  const worker = async () => {
    while (index < unique.length) {
      const item = unique[index];
      index += 1;
      const text = item.text;
      const key = audioKey(text, speed, item.phonetic);
      if (memory.has(key)) {
        loaded += 1;
        options.onDone?.(loaded, unique.length);
        continue;
      }
      try {
        const cached = await cacheGet(key);
        if (cached) {
          loaded += 1;
          options.onDone?.(loaded, unique.length);
          continue;
        }
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            speed,
            ...(item.phonetic ? { word: text, phonemes: item.phonetic } : {}),
          }),
          signal: AbortSignal.timeout(25000),
        });
        if (response.ok && response.headers.get("content-type")?.startsWith("audio/")) {
          const blob = await response.blob();
          if (blob.size) await cachePut(key, blob);
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
