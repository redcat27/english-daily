// 课程内容模型 + AI 生成 + 兜底内容。
import { chatCompletion, parseJsonLoose } from "./minimax";

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
  const feedbackTail = input.feedback.slice(-5);
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
        .slice(0, 30)
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
    `最近用过的场景（避免重复）：${input.recentScenes.join("、") || "无"}`,
    `今天的难度档：${input.difficulty}`,
    "",
    `请生成今天的课程，JSON 结构如下（字段一个都不能少）：`,
    JSON.stringify(
      {
        scene: "场景名，中文，例如「在餐厅点餐」",
        title: "今天的目标，中文一句话",
        level: input.learner.level,
        minutes: 45,
        words: [
          {
            word: "menu",
            phonetic: "/ˈmenjuː/",
            pos: "n.",
            meaning: "菜单",
            example: "Could I see the menu, please?",
            exampleCn: "可以给我看下菜单吗？",
            tip: "发音要点，一句话",
          },
        ],
        dialogue: {
          scene: "对话场景，中文",
          lines: [{ speaker: "A", en: "英文句子", cn: "中文" }],
          upgrades: ["原句 → 更地道的说法（中文说明）"],
          followUp: "一句追问练习题",
        },
        article: {
          title: "短文标题",
          paras: [{ en: "英文句子", cn: "中文" }],
          questions: [{ q: "中文问题", a: "中文答案" }],
          retell: "用 3 句复述的中文任务说明",
        },
        reviewSentences: [{ en: "值得记住的整句", cn: "中文", source: "出处场景" }],
      },
      null,
      2
    ),
    "",
    `数量要求：单词 ${size.words} 个、对话 ${size.lines} 句、短文 ${size.paras} 句。`,
    "单词必须是日常高频词，且必须出现在今天的对话或短文里。",
  ].join("\n");
}

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

export async function generateLesson(input: GenerationInput): Promise<LessonPayload> {
  const prompt = buildUserPrompt(input);
  let raw = await chatCompletion(SYSTEM_PROMPT, prompt);
  let parsed = parseJsonLoose(raw);
  if (!parsed) {
    console.warn("[lesson] JSON 解析失败，重试一次（更严格的指令）", raw.slice(0, 200));
    raw = await chatCompletion(
      SYSTEM_PROMPT + "\n重要：只输出一个 JSON 对象，第一个字符必须是 {，最后一个字符必须是 }，不要任何解释、前后缀或 Markdown 围栏。",
      prompt + "\n（再次提醒：只输出 JSON 对象本身）"
    );
    parsed = parseJsonLoose(raw);
  }
  if (!parsed) {
    console.error("[lesson] 重试后仍不是合法 JSON", raw.slice(0, 200));
    throw new Error("MiniMax 返回的内容不是合法 JSON");
  }
  return normalizeLesson(parsed, FALLBACK_LESSON);
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
