// 课程内容模型 + AI 生成 + 兜底内容。
import { generateJson } from "./ai";

export type WordItem = {
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
  example: string;
  exampleCn: string;
  tip: string;
};

export type DialogueLine = { speaker: string; en: string; cn: string };

export type LessonPayload = {
  scene: string;
  title: string;
  level: string;
  minutes: number;
  words: WordItem[];
  dialogue: {
    scene: string;
    lines: DialogueLine[];
    upgrades: string[];
    followUp: string;
  };
  article: {
    title: string;
    paras: { en: string; cn: string }[];
    questions: { q: string; a: string }[];
    retell: string;
  };
  reviewSentences: { en: string; cn: string; source: string }[];
};

export type GenerationInput = {
  learner: { name: string; level: string };
  feedback: { date: string; shadowing: number; reading: number; note: string }[];
  dueWords: { word: string; meaning: string; hits: number; misses: number }[];
  recentScenes: string[];
  difficulty: "up" | "base" | "down";
};

const SYSTEM_PROMPT = [
  "你是一位面向中文母语者的英语口语老师，学习者初中英语水平、四级未过，目标是把口语说出来。",
  "你只输出 JSON，不要解释，不要 Markdown 代码块以外的内容。",
  "要求：句子短、词汇常用、每个新词必须在本课对话或短文中真实出现；",
  "音标使用国际音标；例句要配中文；语气自然、不装书本。",
].join("\n");

function buildUserPrompt(input: GenerationInput): string {
  const feedbackTail = input.feedback.slice(0, 5);
  const feedbackText = feedbackTail.length
    ? feedbackTail
        .map(
          (f) =>
            `- ${f.date} 跟读 ${f.shadowing}/100 阅读 ${f.reading}/100 ${f.note ? `难点：${f.note}` : ""}`
        )
        .join("\n")
    : "- 暂无历史反馈（第一次学习）";

  const dueText = input.dueWords.length
    ? input.dueWords
        .slice(0, 12)
        .map((w) => `${w.word}(${w.meaning})`)
        .join("、")
    : "无";

  const size =
    input.difficulty === "up"
      ? { words: 10, lines: 10, paras: 7 }
      : input.difficulty === "down"
        ? { words: 4, lines: 6, paras: 4 }
        : { words: 8, lines: 8, paras: 6 };

  return [
    `学习者：${input.learner.name}，当前级别 ${input.learner.level}`,
    `最近学习反馈：\n${feedbackText}`,
    `需要复习的旧词（可以挑 0-3 个放进今天的对话里复用）：${dueText}`,
    `最近用过的场景（避免重复）：${input.recentScenes.slice(0, 3).join("、") || "无"}`,
    `今天的难度档：${input.difficulty}`,
    "",
    `数量要求：words 数组恰好 ${size.words} 项；dialogue.lines 恰好 ${size.lines} 项；article.paras 建议 ${size.paras} 项，每项一对英中段落，英文正文至少 ${size.paras} 个完整句子。`,
    "单词必须是日常高频词，且必须出现在今天的对话或短文里。",
  ].join("\n");
}

const LESSON_SPEC = `整课使用同一个生活场景。只输出一个完整 JSON，结构如下，所有字段必填：
{"scene":"中文场景","title":"中文学习目标","level":"A2","minutes":45,"words":[{"word":"","phonetic":"/.../","pos":"","meaning":"","example":"","exampleCn":"","tip":""}],"dialogue":{"scene":"","lines":[{"speaker":"A","en":"","cn":""}],"upgrades":["原句 → 更自然的说法（中文说明）"],"followUp":"追问练习"},"article":{"title":"","paras":[{"en":"","cn":""}],"questions":[{"q":"","a":""}],"retell":"复述任务"},"reviewSentences":[{"en":"","cn":"","source":""}]}
article.questions 恰好 3 道，reviewSentences 恰好 3 条，整句选自对话或短文；每条整句不超过 80 个字符。
scene 和 source 不超过 60 字符，title 不超过 120 字符，word 和 phonetic 不超过 80 字符，pos 不超过 20 字符，meaning 不超过 160 字符，例句及其译文不超过 300 字符。
只写紧凑 JSON，不要省略课程章节，不要输出思考或 Markdown。`;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

type Loose = Record<string, unknown>;

function asLoose(value: unknown): Loose {
  return value && typeof value === "object" ? (value as Loose) : {};
}

export function normalizeLesson(raw: unknown, fallback: LessonPayload): LessonPayload {
  if (!raw || typeof raw !== "object") return fallback;
  const source = asLoose(raw);
  const dialogue = asLoose(source.dialogue);
  const article = asLoose(source.article);
  const words = Array.isArray(source.words) ? source.words : [];
  const lines = Array.isArray(dialogue.lines) ? dialogue.lines : [];
  const paras = Array.isArray(article.paras) ? article.paras : [];
  const questions = Array.isArray(article.questions) ? article.questions : [];
  const reviewSentences = Array.isArray(source.reviewSentences) ? source.reviewSentences : [];

  return {
    scene: asString(source.scene, fallback.scene),
    title: asString(source.title, fallback.title),
    level: asString(source.level, fallback.level),
    minutes: Number(source.minutes) || fallback.minutes,
    words: words.length
      ? words.map((entry) => {
          const item = asLoose(entry);
          return {
            word: asString(item.word),
            phonetic: asString(item.phonetic),
            pos: asString(item.pos),
            meaning: asString(item.meaning),
            example: asString(item.example),
            exampleCn: asString(item.exampleCn),
            tip: asString(item.tip),
          };
        })
      : fallback.words,
    dialogue: {
      scene: asString(dialogue.scene, fallback.dialogue.scene),
      lines: lines.length
        ? lines.map((entry) => {
            const line = asLoose(entry);
            return {
              speaker: asString(line.speaker, "A"),
              en: asString(line.en),
              cn: asString(line.cn),
            };
          })
        : fallback.dialogue.lines,
      upgrades: Array.isArray(dialogue.upgrades)
        ? dialogue.upgrades.map((entry) => asString(entry)).filter(Boolean)
        : fallback.dialogue.upgrades,
      followUp: asString(dialogue.followUp, fallback.dialogue.followUp),
    },
    article: {
      title: asString(article.title, fallback.article.title),
      paras: paras.length
        ? paras.map((entry) => {
            const para = asLoose(entry);
            return { en: asString(para.en), cn: asString(para.cn) };
          })
        : fallback.article.paras,
      questions: questions.length
        ? questions.map((entry) => {
            const question = asLoose(entry);
            return { q: asString(question.q), a: asString(question.a) };
          })
        : fallback.article.questions,
      retell: asString(article.retell, fallback.article.retell),
    },
    reviewSentences: reviewSentences.map((entry) => {
      const sentence = asLoose(entry);
      return {
        en: asString(sentence.en),
        cn: asString(sentence.cn),
        source: asString(sentence.source),
      };
    }),
  };
}

function requireText(value: unknown, max = 1000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("课程字段缺失或过长");
}

function requireItems(value: unknown, min: number, max: number): Loose[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("课程数量不完整");
  return value.map(asLoose);
}

function validateGeneratedLesson(raw: unknown, input: GenerationInput): LessonPayload {
  const source = asLoose(raw);
  requireText(source.scene, 60);
  requireText(source.title, 120);
  const expected = input.difficulty === "up" ? [10, 10, 7] : input.difficulty === "down" ? [4, 6, 4] : [8, 8, 6];
  for (const word of requireItems(source.words, expected[0], expected[0])) {
    for (const [key, max] of Object.entries({ word: 80, phonetic: 80, pos: 20, meaning: 160, example: 300, exampleCn: 300, tip: 1000 })) requireText(word[key], max);
  }
  const dialogue = asLoose(source.dialogue);
  requireText(dialogue.scene, 120);
  requireText(dialogue.followUp);
  for (const line of requireItems(dialogue.lines, expected[1], expected[1])) {
    for (const key of ["speaker", "en", "cn"]) requireText(line[key]);
  }
  if (!Array.isArray(dialogue.upgrades) || !dialogue.upgrades.length) throw new Error("缺少口语升级练习");
  dialogue.upgrades.forEach((value) => requireText(value));
  const article = asLoose(source.article);
  requireText(article.title);
  requireText(article.retell);
  const paragraphs = requireItems(article.paras, 1, 12);
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  let sentences = 0;
  for (const paragraph of paragraphs) {
    requireText(paragraph.en);
    requireText(paragraph.cn);
    sentences += Array.from(segmenter.segment(paragraph.en)).filter((item) => /[A-Za-z]/.test(item.segment)).length;
  }
  if (sentences < expected[2]) throw new Error("短文句子数量不足");
  for (const question of requireItems(article.questions, 3, 3)) {
    requireText(question.q);
    requireText(question.a);
  }
  for (const sentence of requireItems(source.reviewSentences, 3, 3)) {
    requireText(sentence.en, 80);
    requireText(sentence.cn, 160);
    requireText(sentence.source, 60);
  }
  return normalizeLesson({ ...source, level: input.learner.level }, FALLBACK_LESSON);
}

export async function generateLesson(input: GenerationInput): Promise<LessonPayload> {
  return generateJson(SYSTEM_PROMPT, `${buildUserPrompt(input)}\n\n${LESSON_SPEC}`, (raw) => validateGeneratedLesson(raw, input));
}

export function isCompleteLesson(raw: unknown): raw is LessonPayload {
  const source = asLoose(raw);
  const size = Array.isArray(source.words) ? source.words.length : 0;
  try {
    validateGeneratedLesson(raw, {
      learner: { name: "", level: asString(source.level, "A2") },
      feedback: [], dueWords: [], recentScenes: [],
      difficulty: size === 4 ? "down" : size === 10 ? "up" : "base",
    });
    return true;
  } catch {
    return false;
  }
}

export const FALLBACK_LESSON: LessonPayload = {
  scene: "在餐厅点餐",
  title: "今天点一份饭，并提一个要求",
  level: "A2",
  minutes: 45,
  words: [
    { word: "menu", phonetic: "/ˈmenjuː/", pos: "n.", meaning: "菜单", example: "Could I see the menu, please?", exampleCn: "可以给我看下菜单吗？", tip: "结尾读 /juː/，别读成“menu 的 u”。" },
    { word: "order", phonetic: "/ˈɔːdə(r)/", pos: "v./n.", meaning: "点餐；订购", example: "I'm ready to order.", exampleCn: "我可以点餐了。", tip: "点餐用 I'd like... 比 I want... 礼貌。" },
    { word: "spicy", phonetic: "/ˈspaɪsi/", pos: "adj.", meaning: "辣的", example: "Not too spicy, please.", exampleCn: "请不要太辣。", tip: "太辣 = too spicy；不辣 = not spicy。" },
    { word: "sweet", phonetic: "/swiːt/", pos: "adj.", meaning: "甜的", example: "I want something sweet after dinner.", exampleCn: "晚饭后我想吃点甜的。", tip: "也可以指“贴心的”，先记“甜的”。" },
    { word: "bill", phonetic: "/bɪl/", pos: "n.", meaning: "账单（英式）", example: "Could we have the bill, please?", exampleCn: "可以买单吗？", tip: "英式 bill，美式 check。" },
    { word: "waiter", phonetic: "/ˈweɪtə(r)/", pos: "n.", meaning: "服务员", example: "Could you call the waiter, please?", exampleCn: "能帮我叫一下服务员吗？", tip: "叫服务员前先说 Excuse me。" },
    { word: "water", phonetic: "/ˈwɔːtə(r)/", pos: "n.", meaning: "水", example: "Could I have a glass of water?", exampleCn: "可以给我一杯水吗？", tip: "tap water 自来水，still water 无气泡水。" },
    { word: "vegetable", phonetic: "/ˈvedʒtəbl/", pos: "n.", meaning: "蔬菜", example: "Could I have some vegetables instead of meat?", exampleCn: "可以给我些蔬菜代替肉吗？", tip: "口语常缩写为 veg。" },
  ],
  dialogue: {
    scene: "中餐馆点餐",
    lines: [
      { speaker: "W", en: "Good evening. A table for two?", cn: "晚上好。两位吗？" },
      { speaker: "A", en: "Yes, please. Could I see the menu?", cn: "好的。可以看下菜单吗？" },
      { speaker: "W", en: "Here you are. Can I get you something to drink?", cn: "给您。需要点喝的吗？" },
      { speaker: "A", en: "Just some water, please. I'd like the beef noodles.", cn: "只要水就行。我要牛肉面。" },
      { speaker: "W", en: "Sure. Any special request?", cn: "好的。有什么特别要求吗？" },
      { speaker: "A", en: "Not too salty, and no cilantro, please.", cn: "不要太咸，不要香菜。" },
      { speaker: "W", en: "No problem. Would you like something sweet after your meal?", cn: "没问题。餐后要来点甜的吗？" },
      { speaker: "A", en: "Yes, that's a good idea. Could we have the bill together?", cn: "好啊，这是个好主意。可以一起结账吗？" },
    ],
    upgrades: [
      "I'd like the beef noodles. → Could I have the beef noodles, please?（更礼貌）",
      "No cilantro. → Could you leave out the cilantro, please?（更完整）",
      "Can I get the bill? → Could we have the bill, please?（两个人一起付）",
    ],
    followUp: "追问训练：如果客人说 “I don't like spicy food. What do you recommend?” 你怎么回？",
  },
  article: {
    title: "Lunch Near My Office",
    paras: [
      { en: "Every day I eat lunch near my office.", cn: "我每天在办公室附近吃午饭。" },
      { en: "There is a small Chinese restaurant on the corner.", cn: "拐角有一家小中餐馆。" },
      { en: "The food is cheap and the waiters are friendly.", cn: "饭菜便宜，服务员也很友好。" },
      { en: "I always order the same thing: beef noodles and a cup of tea.", cn: "我总是点同一样：牛肉面加一杯茶。" },
      { en: "Sometimes I ask for less salt because the food is a little heavy.", cn: "有时候我会要求少放盐，因为菜有点重口。" },
      { en: "After lunch I walk back to the office in ten minutes.", cn: "午饭后我走十分钟回到办公室。" },
    ],
    questions: [
      { q: "他每天在哪里吃午饭？", a: "在办公室附近拐角的那家小中餐馆。" },
      { q: "他通常点什么？", a: "牛肉面和一杯茶。" },
      { q: "他为什么要求少盐？", a: "因为菜有点重口（a little heavy）。" },
    ],
    retell: "用 3 句英文说说你每天中午吃什么、在哪里吃。不要照抄原文，用你能说的简单句。",
  },
  reviewSentences: [
    { en: "Could I have the bill, please?", cn: "可以买单吗？", source: "中餐馆点餐" },
    { en: "Not too salty, and no cilantro, please.", cn: "不要太咸，不要香菜。", source: "中餐馆点餐" },
    { en: "Could I have it without spicy, please?", cn: "可以不放辣吗？", source: "中餐馆点餐" },
  ],
};
