import { cacheGet, cachePut, memoryGet, prefetchAudio } from "./audio-cache";

export type PlaybackState = "loading" | "playing" | "idle" | "error";
export type AudioSource = "model" | "system" | "unknown";

type AudioCache = { read: (text: string) => Promise<Blob | null>; write?: (text: string, blob: Blob) => Promise<void> };
type Options = {
  forceSystem?: boolean;
  cache?: AudioCache;
  onState: (state: PlaybackState, message?: string) => void;
  onSource?: (source: AudioSource) => void;
};
type Playback = { stop: () => void; utterance?: SpeechSynthesisUtterance };

let active: Playback | undefined;
let cloudUnavailableUntil = 0;

const sourceListeners = new Set<(source: AudioSource) => void>();

/** 订阅"当前用的什么音源"，用于在界面上显示 AI 音色 / 系统音色 */
export function onAudioSource(listener: (source: AudioSource) => void): () => void {
  sourceListeners.add(listener);
  return () => {
    sourceListeners.delete(listener);
  };
}

function notifySource(source: AudioSource) {
  for (const listener of sourceListeners) listener(source);
}

export function prefersDeviceSpeech(): boolean {
  if (typeof window === "undefined") return false;
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function stopPronunciation() {
  active?.stop();
}

/** 预取本页要朗读的文本，让 iOS 点击时能同步播放模型音色 */
export function primePronunciations(texts: string[], onProgress?: (loaded: number, total: number) => void) {
  return prefetchAudio(texts, { concurrency: 4, onDone: onProgress });
}

// iOS 对游离的 Audio 元素很挑：必须挂在文档里，而且要复用同一个元素，
// 否则 play() 会被静默拒绝（听不到声音）。
let modelAudio: HTMLAudioElement | null = null;

function getModelAudio(): HTMLAudioElement {
  if (!modelAudio) {
    modelAudio = new window.Audio();
    modelAudio.preload = "auto";
    modelAudio.setAttribute("playsinline", "true");
    modelAudio.style.display = "none";
    document.body.appendChild(modelAudio);
  }
  return modelAudio;
}

/** 播放已经取到手的模型音频（必须同步调用，才能保住 iOS 的用户手势） */
function playModelBlob(
  blob: Blob,
  report: (state: PlaybackState) => void,
  finish: (error?: string) => void,
  registerCleanup: (fn: () => void) => void
) {
  const url = URL.createObjectURL(blob);
  const audio = getModelAudio();
  audio.pause();
  audio.src = url;
  registerCleanup(() => {
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    URL.revokeObjectURL(url);
  });
  audio.onplaying = () => report("playing");
  audio.onended = () => finish();
  audio.onerror = () => finish("音频无法播放，请点击“使用系统朗读”。");
  report("loading");
  const result = audio.play();
  if (result && typeof result.then === "function") {
    result.catch(() => finish("播放未启动，请点击“使用系统朗读”。"));
  }
}

// iOS 的 speak() 必须在原始点击调用栈内执行，前面不能 await 缓存或网络。
export function startPronunciation(text: string, options: Options): () => void {
  stopPronunciation();
  let cancelled = false;
  let cleanup = () => {};
  const playback: Playback = {
    stop: () => {
      if (cancelled) return;
      cancelled = true;
      if (active === playback) active = undefined;
      cleanup();
      options.onState("idle");
    },
  };
  active = playback;
  const finish = (error?: string) => {
    if (cancelled) return;
    cancelled = true;
    if (active === playback) active = undefined;
    cleanup();
    options.onState(error ? "error" : "idle", error);
  };
  const report = (state: PlaybackState) => {
    if (!cancelled) options.onState(state);
  };

  const speakNow = (source: AudioSource = "system") => {
    if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      finish("当前浏览器无法朗读，请使用 Safari 打开后重试。");
      return;
    }
    const speech = window.speechSynthesis;
    try {
      const utterance = new window.SpeechSynthesisUtterance(text.trim());
      playback.utterance = utterance;
      utterance.lang = "en-US";
      utterance.rate = 0.95;
      utterance.volume = 1;
      const voices = speech.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
      const voice =
        voices.find((voice) => /^en-US$/i.test(voice.lang) && /samantha|natural|enhanced|premium/i.test(voice.name)) ||
        voices.find((voice) => /^en-US$/i.test(voice.lang)) ||
        voices[0];
      if (voice) utterance.voice = voice;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let started = false;
      cleanup = () => {
        clearTimeout(timer);
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        speech.cancel();
        playback.utterance = undefined;
      };
      utterance.onstart = () => {
        started = true;
        clearTimeout(timer);
        options.onSource?.(source);
        notifySource(source);
        report("playing");
      };
      utterance.onend = () => finish();
      utterance.onerror = () => finish("未能播放。请调高媒体音量、检查静音及蓝牙输出，再点击重试。");
      report("loading");
      speech.cancel();
      speech.speak(utterance);
      speech.resume();
      if (!cancelled && !started) timer = setTimeout(() => finish("朗读未启动。请再次点击；仍无声时请在 Safari 中打开。"), 8000);
    } catch {
      finish("朗读未启动，请再次点击重试。");
    }
  };

  if (!text.trim()) {
    finish("没有可朗读的内容。");
    return () => playback.stop();
  }

  // 1) 内存里已有模型音频：直接同步播放（iOS 也能用上 MiniMax 音色）
  const primed = memoryGet(text.trim());
  if (!options.forceSystem && primed) {
    options.onSource?.("model");
    notifySource("model");
    playModelBlob(
      primed,
      report,
      (error) => {
        if (!error) return finish();
        // 模型音频播不了，退回系统朗读，保证有声音
        cleanup = () => {};
        speakNow("system");
      },
      (fn) => {
        cleanup = fn;
      }
    );
    return () => playback.stop();
  }

  // 2) iOS 且还没预取到：先用系统朗读保证有声音，同时后台把模型音频备好
  if (prefersDeviceSpeech()) {
    options.onSource?.("system");
    notifySource("system");
    speakNow("system");
    void prefetchAudio([text], { concurrency: 1 });
    return () => playback.stop();
  }

  // 3) 桌面/安卓：走云端模型音频
  if (options.forceSystem || Date.now() < cloudUnavailableUntil) {
    speakNow("system");
    return () => playback.stop();
  }

  report("loading");
  const abort = new AbortController();
  cleanup = () => abort.abort();
  void (async () => {
    try {
      let blob = (await options.cache?.read(text).catch(() => null)) ?? memoryGet(text.trim()) ?? null;
      if (cancelled) return;
      if (!blob) {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) {
          cloudUnavailableUntil = Date.now() + 5 * 60000;
          finish("自然人声暂不可用，请点击“使用系统朗读”。");
          return;
        }
        blob = await response.blob();
        if (!blob.size) throw new Error("empty audio");
        if (options.cache?.write) void options.cache.write(text, blob).catch(() => {});
      }
      if (cancelled) return;
      options.onSource?.("model");
    notifySource("model");
      playModelBlob(
        blob,
        report,
        (error) => {
          if (!error) return finish();
          cleanup = () => {};
          speakNow("system");
        },
        (fn) => {
          cleanup = fn;
        }
      );
    } catch {
      if (!cancelled) finish("播放未启动，请点击“使用系统朗读”。");
    }
  })();

  return () => playback.stop();
}

export { cacheGet, cachePut };
