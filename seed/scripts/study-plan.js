'use strict';

/**
 * study-plan.js —— 生活英语口语陪练 · 本地学习任务引擎
 *
 * 设计目标：零依赖、离线运行、不需要任何付费 App。
 * 所有学习数据放在 study/ 目录下的 JSON 文件里，Codex 与小程序都能读写。
 *
 * 用法：
 *   node scripts/study-plan.js today                 打印今天的学习任务（Markdown）
 *   node scripts/study-plan.js today --json          输出 JSON（供小程序/自动化消费）
 *   node scripts/study-plan.js record --day=day-001 --shadowing=70 --output=60 --reading=80 --known=6 --again=2
 *   node scripts/study-plan.js status                查看学习档案、弱点与下一步建议
 *   node scripts/study-plan.js plan-next --days=7    输出后续课程骨架（交给 Codex 填写）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STUDY_DIR = path.join(ROOT, 'study');
const CURR_DIR = path.join(STUDY_DIR, 'curriculum');
const PROFILE_PATH = path.join(STUDY_DIR, 'profile.json');
const PROGRESS_PATH = path.join(STUDY_DIR, 'progress.json');
const VOCAB_PATH = path.join(STUDY_DIR, 'vocab.json');

const BOX_INTERVALS = [0, 1, 3, 7, 15, 30];
const SCORE_KEYS = ['shadowing', 'output', 'reading'];
const LEVEL_LADDER = ['A2', 'A2+', 'B1'];

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function todayISO(d) {
  const date = d || new Date();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + m + '-' + day;
}

function parseISO(iso) {
  const parts = String(iso).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function addDays(iso, n) {
  const t = parseISO(iso) + n * 86400000;
  const d = new Date(t);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const body = token.slice(2);
      if (body.includes('=')) {
        const idx = body.indexOf('=');
        out[body.slice(0, idx)] = body.slice(idx + 1);
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        out[body] = argv[i + 1];
        i += 1;
      } else {
        out[body] = true;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

function toNumber(value) {
  if (value === undefined || value === null || value === true) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function loadProfile() {
  return readJson(PROFILE_PATH, {
    learner: 'learner',
    baseline: {},
    goals: {},
    constraints: {},
    adaptation: { promoteThreshold: 85, demoteThreshold: 65 }
  });
}

function loadProgress() {
  const fallback = {
    streak: 0,
    bestStreak: 0,
    totalDays: 0,
    lastStudyDate: null,
    currentDayId: null,
    level: 'A2',
    difficulty: 'base',
    upDays: 0,
    history: []
  };
  const data = readJson(PROGRESS_PATH, fallback);
  if (!Array.isArray(data.history)) data.history = [];
  return data;
}

function loadVocab() {
  const data = readJson(VOCAB_PATH, { words: [] });
  if (!Array.isArray(data.words)) data.words = [];
  return data;
}

function loadCurriculum() {
  let files = [];
  try {
    files = fs.readdirSync(CURR_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    files = [];
  }
  const days = [];
  for (const file of files) {
    const data = readJson(path.join(CURR_DIR, file), null);
    if (!data) continue;
    if (Array.isArray(data)) days.push(...data);
    else days.push(data);
  }
  days.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return days;
}

function currentDay(days, progress) {
  if (!days.length) return null;
  return days.find((d) => d.id === progress.currentDayId) || days[0];
}

function dueWords(vocab, limit) {
  const today = todayISO();
  return vocab.words
    .filter((w) => !w.dueDate || w.dueDate <= today)
    .sort((a, b) => String(a.dueDate || '0000').localeCompare(String(b.dueDate || '0000')))
    .slice(0, limit || 12);
}

function adaptDay(day, progress) {
  const difficulty = progress.difficulty || 'base';
  const clone = JSON.parse(JSON.stringify(day));
  if (difficulty === 'down') {
    clone.vocab = (clone.vocab || []).slice(0, 4);
    if (clone.article) {
      clone.article.text = (clone.article.text || []).slice(0, 3);
      clone.article.cn = (clone.article.cn || []).slice(0, 3);
      clone.article.questions = (clone.article.questions || []).slice(0, 2);
    }
    clone.tip = '难度下调：今天只求开口流利，不追求完美。';
  } else if (difficulty === 'up') {
    clone.tip = '难度上调：内容加量，并追加追问挑战。';
    clone.challenge = '追加任务：用 3 个追问把今天的对话再延伸 2 轮。';
  } else {
    clone.tip = '难度维持基础档：先把每个场景的句子说熟。';
  }
  return clone;
}

function buildPlan(day, progress, profile, vocab) {
  const adapted = adaptDay(day, progress);
  const review = dueWords(vocab, 12);
  return {
    dayId: adapted.id,
    title: adapted.title,
    scene: adapted.scene,
    level: adapted.level || progress.level,
    difficulty: progress.difficulty || 'base',
    minutes: adapted.minutes || 45,
    tip: adapted.tip,
    challenge: adapted.challenge || null,
    warmup: adapted.warmup || [],
    vocab: adapted.vocab || [],
    dialogue: adapted.dialogue || { scene: '', lines: [], rolePlay: [], upgrades: [] },
    article: adapted.article || null,
    output: adapted.output || null,
    review: review.map((w) => ({ word: w.word, phonetic: w.phonetic, meaning: w.meaning })),
    reportCommand: 'node scripts/study-plan.js record --day=' + adapted.id +
      ' --shadowing=<0-100> --output=<0-100> --reading=<0-100> --known=<个数> --again=<个数>'
  };
}

function renderPlan(plan) {
  const lines = [];
  const push = (s) => lines.push(s);
  push('# 今日任务 · ' + plan.dayId + ' ' + plan.title);
  push('');
  push('- 场景：' + (plan.scene || '通用') + ' | 级别：' + plan.level + ' | 难度档：' + plan.difficulty + ' | 预计 ' + plan.minutes + ' 分钟');
  push('- 今日心法：' + plan.tip);
  push('');
  push('## 1) 热身跟读（5 分钟）');
  plan.warmup.forEach((item, i) => {
    push((i + 1) + '. ' + item.en);
    push('   ' + item.cn);
  });
  push('');
  push('## 2) 记词（10 分钟，共 ' + plan.vocab.length + ' 个）');
  plan.vocab.forEach((item, i) => {
    push((i + 1) + '. ' + item.word + ' ' + (item.phonetic || '') + ' ' + (item.pos || '') + ' ' + item.meaning);
    push('   例：' + item.sentence);
    push('   ' + item.sentenceCn + (item.tip ? ' | ' + item.tip : ''));
  });
  push('');
  push('## 3) 情景对话跟读 + 角色扮演（15 分钟）');
  push('场景：' + (plan.dialogue.scene || ''));
  plan.dialogue.lines.forEach((line) => {
    push(line.speaker + ': ' + line.en);
    push('   ' + line.cn);
  });
  if (plan.dialogue.rolePlay && plan.dialogue.rolePlay.length) {
    push('角色扮演：' + plan.dialogue.rolePlay.join(' '));
  }
  if (plan.dialogue.upgrades && plan.dialogue.upgrades.length) {
    push('地道表达升级：');
    plan.dialogue.upgrades.forEach((u) => push('- ' + u));
  }
  push('');
  if (plan.article) {
    push('## 4) 短文读懂 + 复述（10 分钟）');
    push('标题：' + (plan.article.title || ''));
    plan.article.text.forEach((line, i) => {
      push(line);
      push('   ' + ((plan.article.cn || [])[i] || ''));
    });
    if (plan.article.questions && plan.article.questions.length) {
      push('读完自测：');
      plan.article.questions.forEach((q) => push('- ' + q));
    }
    if (plan.article.retell) push('复述任务：' + plan.article.retell);
  }
  push('');
  if (plan.output) {
    push('## 5) 输出任务（10 分钟，录音或直接打字说给我听）');
    push('题目：' + plan.output.prompt);
    if (plan.output.scaffold && plan.output.scaffold.length) {
      push('脚手架（照着用，说满 3 句）：');
      plan.output.scaffold.forEach((s) => push('- ' + s));
    }
    if (plan.output.sample && plan.output.sample.length) {
      push('参考表达：');
      plan.output.sample.forEach((s) => push('- ' + s));
    }
  }
  push('');
  push('## 6) 复习到期词（5 分钟，共 ' + plan.review.length + ' 个）');
  if (plan.review.length) {
    plan.review.forEach((w) => push('- ' + w.word + ' ' + (w.phonetic || '') + ' ' + w.meaning));
  } else {
    push('- 暂无到期词（正常，第一天还没积攒）');
  }
  if (plan.challenge) {
    push('');
    push('## 7) 加分挑战');
    push(plan.challenge);
  }
  push('');
  push('---');
  push('完成后把三个分数告诉 Codex（跟读/输出/朗读各 0-100），我来更新你的档案：');
  push('`' + plan.reportCommand + '`');
  return lines.join('\n');
}

function averageScore(entry) {
  const values = SCORE_KEYS.map((k) => toNumber(entry[k])).filter((v) => v !== null);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function applyVocabResults(vocab, day, entry, today) {
  const list = (day && day.vocab) || [];
  const known = toNumber(entry.known) || 0;
  const again = toNumber(entry.again) || 0;
  list.forEach((item, index) => {
    let word = vocab.words.find((w) => w.word === item.word);
    if (!word) {
      word = {
        word: item.word,
        phonetic: item.phonetic || '',
        pos: item.pos || '',
        meaning: item.meaning || '',
        sentence: item.sentence || '',
        topic: (day && day.scene) || '',
        lessonDay: (day && day.id) || '',
        box: 0,
        reviews: 0
      };
      vocab.words.push(word);
    }
    const isKnown = index < known;
    const isAgain = index >= list.length - again;
    if (isKnown) word.box = Math.min(5, (word.box || 0) + 1);
    else if (isAgain) word.box = Math.max(0, (word.box || 0) - 1);
    word.lastResult = isKnown ? 'known' : (isAgain ? 'again' : 'new');
    word.reviews = (word.reviews || 0) + 1;
    word.lastSeen = today;
    word.dueDate = addDays(today, BOX_INTERVALS[word.box] || 1);
  });
}

function nextDayId(days, currentId) {
  const idx = days.findIndex((d) => d.id === currentId);
  if (idx === -1) return days.length ? days[0].id : null;
  return idx + 1 < days.length ? days[idx + 1].id : null;
}

function cmdToday(args) {
  const progress = loadProgress();
  const profile = loadProfile();
  const vocab = loadVocab();
  const days = loadCurriculum();
  const day = currentDay(days, progress);
  if (!day) {
    console.log('还没有课程内容。请让 Codex 生成 study/curriculum/day-XXX.json。');
    return;
  }
  const plan = buildPlan(day, progress, profile, vocab);
  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(renderPlan(plan));
}

function cmdRecord(args) {
  const progress = loadProgress();
  const vocab = loadVocab();
  const days = loadCurriculum();
  const today = todayISO();
  const dayId = args.day || progress.currentDayId || (days[0] && days[0].id);
  const day = days.find((d) => d.id === dayId) || null;

  const entry = {
    date: today,
    dayId: dayId,
    shadowing: toNumber(args.shadowing),
    output: toNumber(args.output),
    reading: toNumber(args.reading),
    known: toNumber(args.known),
    again: toNumber(args.again),
    transcript: args.transcript ? String(args.transcript) : '',
    notes: args.notes ? String(args.notes) : ''
  };

  applyVocabResults(vocab, day, entry, today);

  const existing = progress.history.find((h) => h.date === today && h.dayId === dayId);
  if (existing) Object.assign(existing, entry);
  else progress.history.push(entry);

  const dates = new Set(progress.history.map((h) => h.date));
  progress.totalDays = dates.size;
  if (progress.lastStudyDate !== today) {
    const gap = progress.lastStudyDate ? daysBetween(progress.lastStudyDate, today) : 99;
    progress.streak = gap === 1 ? (progress.streak || 0) + 1 : 1;
    progress.lastStudyDate = today;
  }
  progress.bestStreak = Math.max(progress.bestStreak || 0, progress.streak || 0);

  const profile = loadProfile();
  const adapt = profile.adaptation || {};
  const promoteThreshold = toNumber(adapt.promoteThreshold) || 85;
  const demoteThreshold = toNumber(adapt.demoteThreshold) || 65;
  const recent = progress.history.slice(-2);
  const recentAvg = recent.map(averageScore).filter((v) => v !== null);
  const avg = recentAvg.length ? recentAvg.reduce((a, b) => a + b, 0) / recentAvg.length : null;
  const before = progress.difficulty;
  if (avg !== null) {
    if (recent.length >= 2 && avg >= promoteThreshold) progress.difficulty = 'up';
    else if (recent.length >= 2 && avg <= demoteThreshold) progress.difficulty = 'down';
    else progress.difficulty = 'base';
  }
  if (progress.difficulty === 'up') {
    progress.upDays = (progress.upDays || 0) + 1;
    if (progress.upDays >= 10) {
      const idx = LEVEL_LADDER.indexOf(progress.level);
      if (idx >= 0 && idx < LEVEL_LADDER.length - 1) {
        progress.level = LEVEL_LADDER[idx + 1];
        progress.upDays = 0;
      }
    }
  } else {
    progress.upDays = 0;
  }

  const todayAvg = averageScore(entry);
  if (todayAvg === null || todayAvg >= 60) {
    progress.currentDayId = nextDayId(days, dayId);
  } else {
    progress.currentDayId = dayId;
  }

  writeJson(PROGRESS_PATH, progress);
  writeJson(VOCAB_PATH, vocab);

  console.log('已记录 ' + today + ' · ' + dayId);
  console.log('分数：跟读 ' + (entry.shadowing ?? '-') + ' / 输出 ' + (entry.output ?? '-') + ' / 朗读 ' + (entry.reading ?? '-'));
  console.log('连续学习 ' + progress.streak + ' 天 | 累计 ' + progress.totalDays + ' 天 | 当前级别 ' + progress.level + ' | 难度档 ' + progress.difficulty + (before !== progress.difficulty ? '（已调整）' : ''));
  console.log('词库总量 ' + vocab.words.length + '，今日到期复习 ' + dueWords(vocab, 99).length + ' 个');
  if (progress.currentDayId) console.log('下一次任务：' + progress.currentDayId + '（node scripts/study-plan.js today）');
  else console.log('现有课程已全部完成，请让 Codex 生成下一批内容。');
  if (avg !== null && avg <= demoteThreshold) console.log('建议：明天难度下调，目标只有一个——开口说出来。');
  if (avg !== null && avg >= promoteThreshold) console.log('建议：明天难度上调，加入追问和更长表达。');
}

function cmdStatus() {
  const progress = loadProgress();
  const profile = loadProfile();
  const vocab = loadVocab();
  const days = loadCurriculum();
  const day = currentDay(days, progress);
  console.log('# 学习档案');
  console.log('- 学习者：' + (profile.learner || '未设置'));
  console.log('- 起点：' + JSON.stringify(profile.baseline || {}));
  console.log('- 目标：' + JSON.stringify(profile.goals || {}));
  console.log('- 当前级别：' + progress.level + ' | 难度档：' + progress.difficulty);
  console.log('- 连续学习：' + progress.streak + ' 天（最好 ' + progress.bestStreak + '） | 累计：' + progress.totalDays + ' 天');
  console.log('- 词库：' + vocab.words.length + ' 词 | 今日到期复习：' + dueWords(vocab, 99).length + ' 词');
  console.log('- 下一课：' + (day ? day.id + ' ' + day.title : '无'));
  console.log('');
  console.log('## 最近 5 次记录');
  progress.history.slice(-5).forEach((h) => {
    console.log('- ' + h.date + ' ' + h.dayId + ' 跟读 ' + (h.shadowing ?? '-') + ' / 输出 ' + (h.output ?? '-') + ' / 朗读 ' + (h.reading ?? '-'));
  });
  const scores = progress.history.map(averageScore).filter((v) => v !== null);
  if (scores.length >= 2) {
    const first = scores.slice(0, Math.ceil(scores.length / 2));
    const second = scores.slice(Math.ceil(scores.length / 2));
    const f = first.reduce((a, b) => a + b, 0) / first.length;
    const s = second.reduce((a, b) => a + b, 0) / second.length;
    console.log('');
    console.log('趋势：前半段均分 ' + f.toFixed(1) + ' → 后半段均分 ' + s.toFixed(1) + '（' + (s >= f ? '上升' : '下降') + '）');
  }
}

function cmdPlanNext(args) {
  const days = loadCurriculum();
  const count = toNumber(args.days) || 7;
  const startIndex = days.length;
  const scenes = ['约医生', '机场值机', '租房看房', '银行开户', '打车', '退换货', '同事闲聊', '健身房', '寄快递', '投诉'];
  const scaffold = [];
  for (let i = 0; i < count; i += 1) {
    const index = startIndex + i;
    scaffold.push({
      id: 'day-' + String(index + 1).padStart(3, '0'),
      title: '',
      scene: scenes[i % scenes.length],
      level: 'A2+',
      minutes: 45,
      warmup: [{ en: '', cn: '' }],
      vocab: [{ word: '', phonetic: '', pos: '', meaning: '', sentence: '', sentenceCn: '', tip: '' }],
      dialogue: { scene: '', lines: [{ speaker: 'A', en: '', cn: '' }], rolePlay: [], upgrades: [] },
      article: { title: '', text: [''], cn: [''], questions: [''], retell: '' },
      output: { prompt: '', scaffold: [''], sample: [''] }
    });
  }
  console.log(JSON.stringify({ note: '把下面的骨架填成完整 JSON，保存为 study/curriculum/<id>.json', days: scaffold }, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'today';
  if (command === 'today') cmdToday(args);
  else if (command === 'record') cmdRecord(args);
  else if (command === 'status') cmdStatus();
  else if (command === 'plan-next') cmdPlanNext(args);
  else {
    console.log('未知命令：' + command);
    console.log('可用命令：today | record | status | plan-next');
  }
}

main();
