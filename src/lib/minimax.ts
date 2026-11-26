// MiniMax 接口封装：文本生成（次日课程）+ 自然人声 TTS。
// Key 只存在服务端环境变量里，绝不下发到浏览器。

const BASE_URL = (process.env.MINIMAX_BASE_URL || "https://api.minimax.io").replace(/\/$/, "");
const CHAT_ENDPOINT = process.env.MINIMAX_CHAT_ENDPOINT || `${BASE_URL}/v1/text/chatcompletion_v2`;
const TTS_ENDPOINT = process.env.MINIMAX_TTS_ENDPOINT || `${BASE_URL}/v1/t2a_v2`;

export const TTS_VOICE = process.env.MINIMAX_VOICE_ID || "English_expressive_narrator";
export const TTS_SPEED = Number(process.env.MINIMAX_VOICE_SPEED || 1);

export function isMiniMaxConfigured(): boolean {
  return Boolean(process.env.MINIMAX_API_KEY);
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
    "content-type": "application/json",
  };
}

function withGroupId(url: string): string {
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!groupId || /[?&]GroupId=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}GroupId=${encodeURIComponent(groupId)}`;
}

type Loose = Record<string, unknown>;

function asLoose(value: unknown): Loose {
  return value && typeof value === "object" ? (value as Loose) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractText(data: unknown): string {
  const payload = asLoose(data);
  const direct = asText(payload.reply) || asText(payload.text);
  if (direct) return direct;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = asLoose(choices[0]);
  const message = asLoose(first.message);
  return asText(message.content) || asText(first.text);
}

const CHAT_TIMEOUT_MS = Number(process.env.MINIMAX_TIMEOUT_MS || 25000);

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!isMiniMaxConfigured()) throw new Error("MINIMAX_API_KEY 未配置");

  const response = await fetch(withGroupId(CHAT_ENDPOINT), {
    method: "POST",
    headers: authHeaders(),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    body: JSON.stringify({
      model: process.env.MINIMAX_CHAT_MODEL || "MiniMax-M2.5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      // M2.5 是推理模型，输出偏长；上限给足，避免 JSON 被截断
      max_tokens: 8192,
      // 结构化 JSON 任务不需要推理：关掉思考可把耗时减半（实测 8s -> 4s）
      thinking: { type: process.env.MINIMAX_THINKING === "enabled" ? "enabled" : "disabled" },
      stream: false,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`MiniMax 文本接口失败 ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return extractText(data);
}

/** 从任意文本里抠出第一个完整的 JSON 对象（忽略 ```json 围栏、前后解释文字） */
function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** JSON 被 max_tokens 截断时，补齐未闭合的字符串/括号再试一次 */
function repairTruncatedJson(text: string): string | null {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString) {
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    out += ch;
  }
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i -= 1) out += stack[i] === "{" ? "}" : "]";
  return out;
}

export function parseJsonLoose(raw: string): unknown {
  const text = String(raw || "");
  if (!text.trim()) return null;

  const direct = extractJsonObject(text);
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      // 继续尝试修复
    }
  }

  const repaired = repairTruncatedJson(direct ?? text);
  if (repaired) {
    try {
      return JSON.parse(repaired);
    } catch {
      // 继续尝试截断到最后一个完整片段
    }
    let cut = repaired.length;
    while (cut > 0) {
      cut = repaired.lastIndexOf(",", cut - 1);
      if (cut <= 0) break;
      const candidate = repaired.slice(0, cut).replace(/,\s*$/, "") + "]}";
      try {
        return JSON.parse(candidate);
      } catch {
        // 继续回退
      }
    }
  }
  return null;
}

export async function synthesizeSpeech(text: string): Promise<{ audio: Buffer; mime: string } | null> {
  if (!isMiniMaxConfigured() || !text) return null;

  const response = await fetch(withGroupId(TTS_ENDPOINT), {
    method: "POST",
    headers: authHeaders(),
    signal: AbortSignal.timeout(Number(process.env.MINIMAX_TTS_TIMEOUT_MS || 15000)),
    body: JSON.stringify({
      model: process.env.MINIMAX_TTS_MODEL || "speech-2.8-turbo",
      text,
      stream: false,
      voice_setting: {
        voice_id: TTS_VOICE,
        speed: TTS_SPEED,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`MiniMax TTS 失败 ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const hex = asText(asLoose(asLoose(data).data).audio);
  if (!hex) return null;
  const isHex = /^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0;
  const audio = isHex ? Buffer.from(hex, "hex") : Buffer.from(hex, "base64");
  return { audio, mime: "audio/mpeg" };
}


