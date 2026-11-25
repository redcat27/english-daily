import { synthesizeSpeech, isMiniMaxConfigured } from "@/lib/minimax";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const text = String(body?.text || "").slice(0, 600);
  if (!text) return Response.json({ ok: false, error: "text required" }, { status: 400 });

  if (!isMiniMaxConfigured()) {
    return Response.json({ ok: false, error: "MiniMax 未配置" }, { status: 503 });
  }

  try {
    const result = await synthesizeSpeech(text);
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
