import { synthesizeSpeech, isMiniMaxConfigured, TTS_SPEED } from "@/lib/minimax";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const text = String(body?.text || "").slice(0, 600);
  if (!text) return Response.json({ ok: false, error: "text required" }, { status: 400 });

  // 语速由用户控制：0.7（很慢）~ 1.3（偏快），默认沿用服务端配置的语速
  const requested = Number(body?.speed);
  const speed = Number.isFinite(requested) && requested > 0
    ? Math.max(0.6, Math.min(1.4, requested))
    : TTS_SPEED;

  if (!isMiniMaxConfigured()) {
    return Response.json({ ok: false, error: "MiniMax 未配置" }, { status: 503 });
  }

  try {
    const result = await synthesizeSpeech(text, speed);
    if (!result) return Response.json({ ok: false, error: "TTS 无音频" }, { status: 502 });
    return new Response(new Uint8Array(result.audio), {
      headers: {
        "Content-Type": result.mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("[tts] 失败:", error);
    return Response.json({ ok: false, error: "TTS 失败" }, { status: 502 });
  }
}
