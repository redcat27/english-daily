"use client";

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { Learner } from "@/lib/users";
import type { ReviewWord, TodayData } from "@/lib/data";
import type { LessonPayload } from "@/lib/lesson";
import { startPronunciation, type PlaybackState } from "@/lib/pronunciation";

type Props = {
  user: Learner | null;
  data: TodayData | null;
};

const INTERVALS = [1, 2, 4, 7, 15, 30];

/* ---------------- TTS：MiniMax 自然人声 + 浏览器缓存（IndexedDB） ---------------- */

const TTS_DB = "english-tts";
const TTS_STORE = "audio";

function openTtsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TTS_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(TTS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ttsCacheGet(key: string): Promise<Blob | null> {
  try {
    const db = await openTtsDb();
    return await new Promise((resolve) => {
      const req = db.transaction(TTS_STORE, "readonly").objectStore(TTS_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function ttsCachePut(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openTtsDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(TTS_STORE, "readwrite");
      tx.objectStore(TTS_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* 缓存失败不影响使用 */
  }
}

/* ---------------- 小组件 ---------------- */

function SpeakerButton({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<PlaybackState>("idle");
  const [error, setError] = useState("");
  const stop = useRef<(() => void) | null>(null);
  const errorId = useId();
  const busy = state === "loading" || state === "playing";

  useEffect(() => () => stop.current?.(), []);

  // 保持同步调用：iPhone 不能等异步接口失败后才尝试系统语音。
  const onClick = (event: MouseEvent, forceSystem = false) => {
    event.stopPropagation();
    if (busy) {
      stop.current?.();
      return;
    }
    setError("");
    stop.current = startPronunciation(text, {
      forceSystem: forceSystem || state === "error",
      cache: { read: ttsCacheGet, write: ttsCachePut },
      onState: (next, message) => { setState(next); setError(message || ""); },
    });
  };

  return (
    <span className="speaker-control">
      <button type="button" className={"speak" + (busy ? " playing" : "")} onClick={onClick}
        aria-label={busy ? "停止朗读" : label || "朗读"} aria-pressed={busy} aria-describedby={error ? errorId : undefined}>
        {busy ? <span aria-hidden="true">■</span> : <svg className="ic"><use href="#i-play" /></svg>}
      </button>
      {error ? (
        <span className="audio-error" id={errorId} role="status">
          {error}
          <button type="button" className="btn-sm" onClick={(event) => onClick(event, true)}>使用系统朗读</button>
        </span>
      ) : null}
    </span>
  );
}

function UserPicker({
  onPick,
  current,
}: {
  onPick: (key: string) => void;
  current: Learner | null;
}) {
  const learners: Learner[] = [
    { key: "teefs", name: "teefs", gender: "男", initial: "T", level: "A2" },
    { key: "groot", name: "groot", gender: "女", initial: "G", level: "A2" },
  ];
  return (
    <div className="picker-mask">
      <div className="picker">
        <h1>每日英语</h1>
        <p>{current ? "切换学习者" : "选择学习者后开始今天的课程"}</p>
        {learners.map((learner) => (
          <button key={learner.key} className="ucard" onClick={() => onPick(learner.key)}>
            <span className={"avatar " + learner.key}>{learner.initial}</span>
            <span>
              <span className="un">{learner.name}</span>
              <span className="ug">{learner.gender} · {learner.level} 级</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type LocalReview = ReviewWord & {
  graded?: "know" | "forgot";
  graduatedNow?: boolean;
};

function dueLabel(item: LocalReview) {
  if (item.graduated || item.graduatedNow) return "已毕业";
  const days = INTERVALS[Math.min(Math.max(item.box, 1), INTERVALS.length) - 1];
  return `第 ${item.box} 盒 · ${days} 天后`;
}

function ReviewCard({
  item,
  index,
  onGrade,
  sentence,
}: {
  item: LocalReview;
  index: number;
  onGrade: (key: string, result: "know" | "forgot") => void;
  sentence?: { en: string; cn: string; source: string };
}) {
  const [revealed, setRevealed] = useState(false);
  const head = sentence?.en ?? item.word;
  const phonetic = sentence ? "" : item.phonetic;
  const meaning = sentence?.cn ?? item.meaning;
  const example = sentence ? "" : item.example;
  const exampleCn = sentence ? "" : item.exampleCn;
  const key = sentence?.en ?? item.word;

  return (
    <div className={"card rcard" + (revealed ? " revealed" : "")}>
      <div className="rhead">
        <span className="box-chip">{sentence ? "句子卡" : dueLabel(item)}</span>
        <span>第 {index + 1} 张</span>
        <span style={{ marginLeft: "auto" }}>
          {!sentence && item.hits ? `已连续记住 ${item.hits} 次` : ""}
        </span>
      </div>
      <div className="w">{head}</div>
      {phonetic ? <div className="ph">{phonetic}</div> : null}
      <div className="hide m">{meaning}</div>
      {sentence ? null : (
        <div className="hide eg">
          {example}
          <div className="cn">{exampleCn}</div>
        </div>
      )}
      <div className="rbtns">
        <SpeakerButton text={head} />
      </div>
      {!item.graded ? (
        <>
          {!revealed ? (
            <div className="rbtns">
              <button
                className="rbtn"
                style={{ background: "var(--color-surface-dynamic)", color: "var(--color-text-muted)" }}
                onClick={() => setRevealed(true)}
              >
                看释义和例句
              </button>
            </div>
          ) : null}
          <div className="rbtns">
            <button className="rbtn know" onClick={() => onGrade(key, "know")}>
              ✓ 记住了
            </button>
            <button className="rbtn forgot" onClick={() => onGrade(key, "forgot")}>
              ✗ 没记住
            </button>
          </div>
        </>
      ) : (
        <div className="rbtns">
          <div
            className={"rbtn " + (item.graded === "know" ? "know" : "forgot")}
            style={{ cursor: "default" }}
          >
            {item.graded === "know" ? "✓ 记住了" : "✗ 没记住"}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LessonApp({ user, data }: Props) {
  const router = useRouter();
  const activeUser = user;
  const [pickerOpen, setPickerOpen] = useState(!user);
  const [lesson] = useState<LessonPayload | null>(data?.lesson ?? null);
  const [review, setReview] = useState<LocalReview[]>(data?.review ?? []);
  const [enOnly, setEnOnly] = useState(false);
  const [shadowing, setShadowing] = useState(70);
  const [reading, setReading] = useState(65);
  const [note, setNote] = useState("");
  const [doneDialogue, setDoneDialogue] = useState(false);
  const [doneArticle, setDoneArticle] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [tomorrow, setTomorrow] = useState<{ scene: string; title: string; words: number } | null>(null);
  const [generationMessage, setGenerationMessage] = useState("");
  const [todayMessage, setTodayMessage] = useState("");
  const [todayAttempt, setTodayAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<"word" | "sentence">("word");
  const [sentenceGrades, setSentenceGrades] = useState<Record<string, "know" | "forgot">>({});
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2400);
  }, []);

  useEffect(() => {
    if (!data?.lessonPending || !activeUser) return;
    const controller = new AbortController();
    const request = async (url: string, method = "GET") => {
      const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error("今日课程准备失败，请点击重试。");
      return result;
    };
    void (async () => {
      try {
        setTodayMessage("正在为你准备今日课程…");
        let result = await request("/api/next-preview?day=today", "POST");
        const task = result.task;
        const deadline = Date.now() + 125000;
        while (result.status === "running" && Date.now() < deadline && !controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          result = await request(`/api/next-preview?task=${encodeURIComponent(task)}`);
        }
        if (controller.signal.aborted) return;
        if (result.status === "done") router.refresh();
        else setTodayMessage(result.error || "今日课程尚未完成，请点击重试。");
      } catch {
        if (!controller.signal.aborted) setTodayMessage("今日课程准备失败，请点击重试。");
      }
    })();
    return () => controller.abort();
  }, [data?.lessonPending, activeUser, todayAttempt, router]);

  const pickUser = async (key: string) => {
    setBusy(true);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: key }),
      });
      setPickerOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const onGrade = async (key: string, result: "know" | "forgot") => {
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: key, result }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.next) throw new Error("复习结果未保存");
      if (payload?.next) {
        const next = payload.next;
        setSentenceGrades((prev) => ({ ...prev, [key]: result }));
        setReview((prev) =>
          prev.map((item) =>
            item.word === key
              ? {
                  ...item,
                  graded: result,
                  box: next.box,
                  hits: next.hits,
                  graduatedNow: next.graduated,
                }
              : item
          )
        );
        if (next.graduated) notify("这个词毕业了，不再出现");
        else if (result === "know") notify(`记住了，${INTERVALS[Math.min(next.box, INTERVALS.length) - 1]} 天后再见`);
        else notify("没关系，明天再来一次");
      }
    } catch {
      notify("复习结果未保存，请重试。");
    }
  };

  const submitFeedback = async () => {
    setBusy(true);
    setGenerationMessage("");
    let saved = false;
    try {
      // 第一步：反馈落库（快，不等 AI）
      const feedback = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shadowing, reading, note }),
      });
      const receipt = await feedback.json().catch(() => ({}));
      if (!feedback.ok || !receipt.saved) throw new Error("反馈保存失败，请稍后重试");
      saved = true;
      setSubmitted(true);
      notify("反馈已保存，正在生成明天的课…");

      // 生成在服务器后台执行；浏览器只查询状态，不占用长请求。
      const preview = await fetch("/api/next-preview", { method: "POST", signal: AbortSignal.timeout(10000) });
      let result = await preview.json().catch(() => ({}));
      if (!preview.ok) throw new Error("反馈已保存，课程暂时无法生成，请稍后重试。");
      const deadline = Date.now() + 125000;
      const task = result.task;
      while (result.status === "running" && Date.now() < deadline) {
        setGenerationMessage("反馈已保存，正在生成明天的课…");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await fetch(`/api/next-preview?task=${encodeURIComponent(task)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        result = await status.json().catch(() => ({}));
        if (!status.ok) throw new Error("反馈已保存，暂时无法查询课程，请稍后重试。");
      }
      if (result.status !== "done" || !result.tomorrow) throw new Error(result.error || "反馈已保存，课程仍未完成，请稍后重试。");
      setTomorrow(result.tomorrow);
      setGenerationMessage("明天的课已生成并保存。");
      notify("明天的课已生成");
    } catch (error) {
      const message = saved ? (error instanceof Error && error.name !== "TimeoutError" ? error.message : "反馈已保存，课程生成暂时失败，请稍后重试。") : "反馈保存失败，请稍后重试。";
      setGenerationMessage(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  };

  const gradedCount = review.filter((item) => item.graded).length;
  const progressSteps = [
    gradedCount >= 4,
    doneDialogue,
    doneArticle,
    submitted,
  ];
  const progressDone = progressSteps.filter(Boolean).length;
  const progressPct = Math.round((progressDone / progressSteps.length) * 100);

  const stats = data?.stats;

  return (
    <>
      {pickerOpen ? <UserPicker current={activeUser} onPick={pickUser} /> : null}

      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <span className="dot" />
            每日英语 <small className="mono">daily-english</small>
          </div>
          <div className="spacer" />
          {activeUser ? (
            <button className="user-chip" onClick={() => setPickerOpen(true)}>
              <span className={"avatar mini " + activeUser.key}>{activeUser.initial}</span>
              <span>{activeUser.name}</span>
            </button>
          ) : null}
          <button
            className="icon-btn"
            aria-label="切换主题"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <svg className="ic"><use href={theme === "dark" ? "#i-sun" : "#i-moon"} /></svg>
          </button>
        </div>
      </header>

      <main className="wrap">
        {data?.lessonWarning ? (
          <div role="status">
            <p>{data.lessonWarning} {todayMessage}</p>
            <button className="btn" onClick={() => setTodayAttempt((value) => value + 1)}>重新查询或生成今日课程</button>
          </div>
        ) : null}
        <div className="hero">
          <div className="scene mono">Day {stats ? stats.totalDays + 1 : 1} · 场景：{lesson?.scene}</div>
          <h1>{lesson?.title}</h1>
          <div className="chips">
            <span className="chip"><b>{stats?.streak ?? 0}</b> 天连续</span>
            <span className="chip">级别 <b>{activeUser?.level ?? "A2"}</b></span>
            <span className="chip">约 <b>{lesson?.minutes ?? 45}</b> 分钟</span>
            <span className="chip accent">今日复习 {review.length} 条</span>
          </div>
          <div className="progress">
            <div className="progress-bar"><i style={{ width: progressPct + "%" }} /></div>
            <div className="progress-label">
              <span>今日进度 {progressDone} / {progressSteps.length}</span>
              <span className="mono">{progressPct}%</span>
            </div>
          </div>
        </div>

        <section>
          <div className="sec-head">
            <span className="n">01</span>
            <h2>今日复习</h2>
            <span className="hint">{gradedCount} / {review.length} 已复习</span>
          </div>
          <div className="tabs">
            <button className={"rtab" + (tab === "word" ? " active" : "")} onClick={() => setTab("word")}>单词卡</button>
            <button className={"rtab" + (tab === "sentence" ? " active" : "")} onClick={() => setTab("sentence")}>句子卡</button>
          </div>
          {tab === "word" ? (
            <div>
              {review.length ? (
                review.map((item, index) => (
                  <ReviewCard key={item.word} item={item} index={index} onGrade={onGrade} />
                ))
              ) : (
                <div className="card" style={{ padding: 14, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                  今天没有到期的复习词。学过的新词会按记忆曲线安排到后面几天。
                </div>
              )}
            </div>
          ) : (
            <div>
              {(lesson?.reviewSentences ?? []).length ? (
                lesson!.reviewSentences.map((sentence, index) => (
                  <ReviewCard
                    key={sentence.en}
                    item={{ ...blankReview, word: sentence.en, meaning: sentence.cn, graded: sentenceGrades[sentence.en] }}
                    index={index}
                    sentence={sentence}
                    onGrade={onGrade}
                  />
                ))
              ) : (
                <div className="card" style={{ padding: 14, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                  今天还没有需要记的整句。
                </div>
              )}
            </div>
          )}
          <div className="card srs-note">
            <b>记忆法：Leitner 间隔重复</b>
            <br />
            答「记住了」→ 进下一盒，下次间隔变长；答「没记住」→ 退回第 1 盒，隔天再来。
            <br />
            <b>连续记住 3 次就毕业</b>，不再出现；答错则从头再来。
            <div className="srs-ladder">
              <span className="on">1天</span><span className="on">2天</span><span>4天</span><span>7天</span><span>15天</span><span>30天</span>
            </div>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="n">02</span>
            <h2>今日新词</h2>
            <span className="hint">点卡片看例句</span>
          </div>
          {(lesson?.words ?? []).map((item, index) => (
            <WordRow key={item.word} item={item} index={index} />
          ))}
        </section>

        <section>
          <div className="sec-head">
            <span className="n">03</span>
            <h2>情景对话</h2>
            <span className="hint">
              <button
                className={"chip" + (enOnly ? " accent" : "")}
                onClick={() => setEnOnly((value) => !value)}
              >
                {enOnly ? "显示中文" : "只看英文"}
              </button>
            </span>
          </div>
          <div className="card">
            <div className="dlg">
              {(lesson?.dialogue.lines ?? []).map((line, index) => (
                <div className="line" key={index}>
                  <div className="spk">{line.speaker}</div>
                  <div className="body">
                    <div className="en">{line.en}</div>
                    <div className="cn">{line.cn}</div>
                  </div>
                  <SpeakerButton text={line.en} />
                </div>
              ))}
            </div>
          </div>
          {(lesson?.dialogue.upgrades.length || lesson?.dialogue.followUp) ? (
            <div className="card upgrades">
              {lesson?.dialogue.upgrades.length ? (
                <>
                  <h4>更地道的说法</h4>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {lesson.dialogue.upgrades.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {lesson?.dialogue.followUp ? (
                <>
                  <h4 style={{ marginTop: 12 }}>追问训练</h4>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                    {lesson.dialogue.followUp}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className={"btn" + (doneDialogue ? "" : " primary")}
                onClick={() => setDoneDialogue((value) => !value)}
              >
                {doneDialogue ? "✓ 已完成" : "✓ 跟读完成"}
              </button>
              <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                自己跟读 3 遍：原速 → 慢速 → 只看英文
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="n">04</span>
            <h2>今日短文</h2>
            <span className="hint">读完做 3 道题</span>
          </div>
          <div className="card article">
            <h3>{lesson?.article.title}</h3>
            {(lesson?.article.paras ?? []).map((para, index) => (
              <div className="para" key={index}>
                <div className="en">{para.en}</div>
                <div className="cn">{para.cn}</div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <SpeakerButton text={(lesson?.article.paras ?? []).map((p) => p.en).join(" ")} label="通读全文" />
              <button
                className={"btn" + (doneArticle ? "" : " primary")}
                onClick={() => setDoneArticle((value) => !value)}
              >
                {doneArticle ? "✓ 已读完" : "✓ 读完了"}
              </button>
            </div>
          </div>
          <div className="card">
            {(lesson?.article.questions ?? []).map((question, index) => (
              <QuestionRow key={index} index={index} question={question} />
            ))}
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
              复述任务
            </div>
            <div style={{ fontSize: "var(--text-sm)" }}>{lesson?.article.retell}</div>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span className="n">05</span>
            <h2>今日反馈</h2>
            <span className="hint">决定明天的内容</span>
          </div>
          <div className="card fb">
            <div className="fb-row">
              <label>
                跟读 <span className="faint">对话模仿得像不像</span>
                <b>{shadowing}</b>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={shadowing}
                onChange={(event) => setShadowing(Number(event.target.value))}
              />
            </div>
            <div className="fb-row">
              <label>
                阅读 <span className="faint">短文读得顺不顺</span>
                <b>{reading}</b>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={reading}
                onChange={(event) => setReading(Number(event.target.value))}
              />
            </div>
            <textarea
              value={note}
              placeholder="今天最难的地方是什么？（例：不知道怎么说“打包带走”）"
              onChange={(event) => setNote(event.target.value)}
            />
            <button className="btn primary submit" onClick={submitFeedback} disabled={busy || data?.lessonPending}>
              {busy ? "生成中，请稍候…" : submitted ? "反馈已保存，重试或查看明天的课" : "提交反馈，生成明天的课"}
            </button>
            {generationMessage ? <p role="status" aria-live="polite">{generationMessage}</p> : null}
            {tomorrow ? (
              <div style={{ marginTop: 14, padding: 12, borderRadius: "var(--radius-lg)", background: "var(--color-primary-highlight)", border: "1px solid transparent" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--color-primary)", letterSpacing: ".06em", marginBottom: 6 }}>
                  明天 · Day {Number(stats?.totalDays ?? 0) + 2}
                </div>
                <div style={{ fontSize: "var(--text-sm)" }}>
                  场景：<b>{tomorrow.scene}</b>（{tomorrow.words} 个新词）
                  <br />
                  {tomorrow.title}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="proto-note">
          <b>数据策略</b>：今天的对话/短文/单词内容只保留当天，新的一天生成时自动清掉更早的当日内容；
          单词的复习状态（盒子等级、记住次数、下次复习日）和每天的学习反馈长期保留，作为 AI 生成次日课程的依据。
        </div>
      </main>

      <div className="bottom">
        <div className="bottom-inner">
          <button className="btn" onClick={() => setPickerOpen(true)}>
            <svg className="ic"><use href="#i-swap" /></svg> 切换用户
          </button>
          <button
            className="btn"
            onClick={async () => {
              const text = `【每日英语 · ${activeUser?.name ?? ""}】跟读 ${shadowing} / 阅读 ${reading}\n难点：${note || "（没写）"}\n已复习 ${gradedCount} 条`;
              try {
                await navigator.clipboard.writeText(text);
                notify("已复制学习记录");
              } catch {
                notify("复制失败");
              }
            }}
          >
            <svg className="ic"><use href="#i-copy" /></svg> 复制记录
          </button>
        </div>
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

const blankReview: LocalReview = {
  word: "",
  phonetic: "",
  pos: "",
  meaning: "",
  example: "",
  exampleCn: "",
  box: 1,
  hits: 0,
  misses: 0,
  graduated: false,
  dueDate: "",
};

function WordRow({ item, index }: { item: LessonPayload["words"][number]; index: number }) {
  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState<"known" | "unsure" | null>(null);
  return (
    <div className={"card word" + (open ? " open" : "")}>
      <button className="word-toggle" onClick={() => setOpen((value) => !value)}>
        <div className="word-top">
          <div className="word-main">
            <div className="word-en">
              {item.word}
              <span className="word-ph">{item.phonetic}</span>
            </div>
            <div className="word-cn">
              <i>{item.pos}</i>
              {item.meaning}
            </div>
          </div>
        </div>
      </button>
      <div className="word-detail">
        <div className="eg">
          {item.example}
          <div className="cn">{item.exampleCn}</div>
        </div>
        {item.tip ? <div className="tip">💡 {item.tip}</div> : null}
        <div className="word-actions">
          <button
            className={"btn-sm" + (mark === "known" ? " on-known" : "")}
            onClick={() => setMark(mark === "known" ? null : "known")}
          >
            ✓ 认识
          </button>
          <button
            className={"btn-sm" + (mark === "unsure" ? " on-unsure" : "")}
            onClick={() => setMark(mark === "unsure" ? null : "unsure")}
          >
            ~ 还不太熟
          </button>
          <SpeakerButton text={item.word} />
        </div>
      </div>
      <span hidden>{index}</span>
    </div>
  );
}

function QuestionRow({
  index,
  question,
}: {
  index: number;
  question: { q: string; a: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"qa" + (open ? " open" : "")}>
      <button className="q" onClick={() => setOpen((value) => !value)}>
        <span className="num">Q{index + 1}</span>
        <span className="txt">{question.q}</span>
        <svg className="ic caret"><use href="#i-caret" /></svg>
      </button>
      <div className="a">💡 {question.a}</div>
    </div>
  );
}

