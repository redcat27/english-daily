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

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!isMiniMaxConfigured()) throw new Error("MINIMAX_API_KEY 未配置");

  const response = await fetch(withGroupId(CHAT_ENDPOINT), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: process.env.MINIMAX_CHAT_MODEL || "MiniMax-M2.5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      stream: false,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`MiniMax 文本接口失败 ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return extractText(data);
}

export function parseJsonLoose(raw: string): unknown {
  const text = String(raw || "");
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export async function synthesizeSpeech(text: string): Promise<{ audio: Buffer; mime: string } | null> {
  if (!isMiniMaxConfigured() || !text) return null;

  const response = await fetch(withGroupId(TTS_ENDPOINT), {
    method: "POST",
    headers: authHeaders(),
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


