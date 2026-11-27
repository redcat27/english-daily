// 探测可用的美式英语音色
const fs = require('fs');
function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let rest = t.slice(eq + 1).trim();
    let value;
    if (rest.startsWith('"') || rest.startsWith("'")) { const q = rest[0]; const end = rest.indexOf(q, 1); value = end > 0 ? rest.slice(1, end) : rest.slice(1); }
    else { const hash = rest.indexOf(' #'); value = hash >= 0 ? rest.slice(0, hash).trim() : rest; }
    if (value) out[key] = value;
  }
  return out;
}
const env = loadEnv('.env');
const BASE = env.MINIMAX_BASE_URL;
const KEY = env.MINIMAX_API_KEY;

const candidates = [
  'English_expressive_narrator', 'English_explanatory_narrator', 'English_narrator',
  'English_NewsAnchor', 'English_ConfidentNarrator', 'English_CrispNarrator',
  'English_CalmNarrator', 'English_UpbeatNarrator', 'English_FriendlyNarrator',
  'English_DeepVoiceMan', 'English_TrustworthyMan', 'English_ThoughtfulMan',
  'English_CasualNarrator', 'English_ConfidentMan', 'English_CasualMan',
  'English_BrightNarrator', 'English_CuriousBoy', 'English_Announcer',
  'English (American)_Male_1', 'English (American)_Female_1',
  'English (American)_Narrator', 'English (American)_Man',
  'English (British)_Male_1', 'English (British)_Female_1',
  'American_man', 'American_narrator', 'English_man', 'English_woman'
];

(async () => {
  const ok = [];
  for (const v of candidates) {
    try {
      const r = await fetch(BASE + '/v1/t2a_v2', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo',
          text: 'Good morning. Could I have the bill, please?',
          stream: false,
          voice_setting: { voice_id: v, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
        })
      });
      const d = await r.json().catch(() => ({}));
      const code = d?.base_resp?.status_code;
      if (code === 0 || d?.data?.audio) ok.push(v + ' (' + (d?.data?.audio ? Math.round(d.data.audio.length / 2 / 1024) + 'KB' : '') + ')');
    } catch (e) {}
  }
  console.log('可用音色:\n  ' + ok.join('\n  '));
})();
