import { chatCompletion, parseJsonLoose } from "./minimax";

export class AIUnavailableError extends Error {
  constructor() {
    super("课程生成服务暂时不可用，请稍后重试；已保存的反馈不会丢失。");
    this.name = "AIUnavailableError";
  }
}

function timeoutMs(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.min(parsed, 45000) : fallback;
}

async function senseNovaCompletion(system: string, user: string, model: string, timeout: number, signal: AbortSignal): Promise<string> {
  const base = (process.env.SENSENOVA_BASE_URL || "https://token.sensenova.cn/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SENSENOVA_API_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.4,
      max_tokens: 8192,
      thinking: { type: "disabled" },
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      stream: false,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) throw new Error(`SenseNova HTTP ${response.status}`);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason !== "stop") throw new Error("SenseNova 输出未完整结束");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("SenseNova 返回空内容");
  return content;
}

// 每个候选模型最多尝试一次；三次尝试共享 85 秒预算，给数据库写入留出时间。
export async function generateJson<T>(system: string, user: string, validate: (value: unknown) => T): Promise<T> {
  const primary = process.env.SENSENOVA_CHAT_MODEL || "deepseek-flash";
  const fallback = process.env.SENSENOVA_FALLBACK_MODEL || "sensenova-6.8-flash-lite";
  const models = [...new Set([primary, fallback])];
  const providers = [
    ...models.map((model, index) => ({
      name: `sensenova/${model}`,
      configured: Boolean(process.env.SENSENOVA_API_KEY),
      run: (system: string, user: string, signal: AbortSignal) => senseNovaCompletion(system, user, model, index === 0 ? timeoutMs(process.env.SENSENOVA_TIMEOUT_MS, 40000) : 25000, signal),
    })),
    { name: "minimax", configured: Boolean(process.env.MINIMAX_API_KEY), run: chatCompletion },
  ];
  if (process.env.AI_PRIMARY_PROVIDER === "minimax") providers.unshift(providers.pop()!);
  const signal = AbortSignal.timeout(85000);
  for (const provider of providers.filter((item) => item.configured)) {
    if (signal.aborted) break;
    const started = Date.now();
    try {
      const result = validate(parseJsonLoose(await provider.run(system, user, signal)));
      console.info(`[ai] provider=${provider.name} status=ok durationMs=${Date.now() - started}`);
      return result;
    } catch (error) {
      // 只记录错误类型和耗时，不记录提示词、密钥或供应商原始响应。
      console.warn(`[ai] provider=${provider.name} status=failed durationMs=${Date.now() - started} kind=${error instanceof Error ? error.name : "Error"}`);
    }
  }
  throw new AIUnavailableError();
}
