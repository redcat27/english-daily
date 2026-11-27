// 探测 TTS API 对「美式化」相关参数的支持：english_normalization / pronunciation_dict / emotion
const fs = require('fs');
function loadEnv(file){const out={};for(const l of fs.readFileSync(file,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if(v.startsWith('"')||v.startsWith("'")){const q=v[0];const i=v.indexOf(q,1);v=i>0?v.slice(1,i):v.slice(1);}else{const h=v.indexOf(' #');v=h>=0?v.slice(0,h).trim():v;}if(v)out[k]=v;}return out;}
const env = loadEnv('.env');
const BASE = env.MINIMAX_BASE_URL, KEY = env.MINIMAX_API_KEY;

async function tts(label, extra, text) {
  const r = await fetch(BASE + '/v1/t2a_v2', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo',
      text: text || 'The schedule says the water is on Tuesday.',
      stream: false,
      voice_setting: { voice_id: 'American_narrator', speed: 0.85, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      ...extra
    })
  });
  const d = await r.json().catch(() => ({}));
  const code = d?.base_resp?.status_code;
  const msg = d?.base_resp?.status_msg || '';
  const bytes = d?.data?.audio ? d.data.audio.length / 2 : 0;
  console.log(`${label.padEnd(34)} http=${r.status} code=${code} ${bytes}B ${msg ? '| ' + msg.slice(0, 70) : ''}`);
  return d;
}

(async () => {
  await tts('基线（只带 voice_setting）', {});
  await tts('+english_normalization', { voice_setting: { voice_id: 'American_narrator', speed: 0.85, vol: 1, pitch: 0, english_normalization: true } });
  await tts('+emotion=happy', { voice_setting: { voice_id: 'American_narrator', speed: 0.85, vol: 1, pitch: 0, emotion: 'happy' } });
  await tts('+pronunciation_dict(顶层)', { pronunciation_dict: [{ word: 'schedule', phonemes: 'skedʒuːl' }] });
  await tts('+pronunciation_dict(在 voice_setting 内)', { voice_setting: { voice_id: 'American_narrator', speed: 0.85, vol: 1, pitch: 0, pronunciation_dict: [{ word: 'schedule', phonemes: 'skedʒuːl' }] } });
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
