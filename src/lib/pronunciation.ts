export type PlaybackState = "loading" | "playing" | "idle" | "error";
type AudioCache = { read: (text: string) => Promise<Blob | null>; write?: (text: string, blob: Blob) => Promise<void> };
type Options = { forceSystem?: boolean; cache?: AudioCache; onState: (state: PlaybackState, message?: string) => void };
type Playback = { stop: () => void; utterance?: SpeechSynthesisUtterance };
let active: Playback | undefined;
let cloudUnavailableUntil = 0;

export function prefersDeviceSpeech(): boolean {
  if (typeof window === "undefined") return false;
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1) ||
    (/Safari\//.test(userAgent) && !/Chrome|Chromium|Edg|Android/.test(userAgent));
}

export function stopPronunciation() {
  active?.stop();
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
  const report = (state: PlaybackState) => { if (!cancelled) options.onState(state); };

  const speakNow = () => {
    if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      finish("当前浏览器无法朗读，请使用 Safari 打开后重试。");
      return;
    }
    const speech = window.speechSynthesis;
    try {
      const utterance = new window.SpeechSynthesisUtterance(text.trim());
      // 保留强引用直到结束，避免长短文朗读时被回收。
      playback.utterance = utterance;
      utterance.lang = "en-US";
      utterance.rate = 0.95;
      utterance.volume = 1;
      const voices = speech.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
      const voice = voices.find((voice) => /^en-US$/i.test(voice.lang) && /samantha|natural|enhanced|premium/i.test(voice.name)) ||
        voices.find((voice) => /^en-US$/i.test(voice.lang)) || voices[0];
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
      utterance.onstart = () => { started = true; clearTimeout(timer); report("playing"); };
      utterance.onend = () => finish();
      utterance.onerror = () => finish("未能播放。请调高媒体音量、检查静音及蓝牙输出，再点击重试。");
      report("loading");
      // 声音列表尚未加载时使用 lang 默认音色，不能等待 voiceschanged 丢失点击权限。
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
  } else if (options.forceSystem || prefersDeviceSpeech() || Date.now() < cloudUnavailableUntil) {
    speakNow();
  } else {
    report("loading");
    const abort = new AbortController();
    cleanup = () => abort.abort();
    void (async () => {
      try {
        let blob = await options.cache?.read(text).catch(() => null);
        if (cancelled) return;
        if (!blob) {
          const response = await fetch("/api/tts", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
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
        const url = URL.createObjectURL(blob);
        const audio = new window.Audio(url);
        cleanup = () => {
          abort.abort();
          audio.onplaying = null;
          audio.onended = null;
          audio.onerror = null;
          audio.pause();
          URL.revokeObjectURL(url);
        };
        audio.onplaying = () => report("playing");
        audio.onended = () => finish();
        audio.onerror = () => finish("音频无法播放，请点击“使用系统朗读”。");
        // 不吞掉 play() 的拒绝；下一次明确点击可直接启动系统朗读。
        await audio.play();
      } catch {
        if (!cancelled) finish("播放未启动，请点击“使用系统朗读”。");
      }
    })();
  }
  return () => playback.stop();
}
