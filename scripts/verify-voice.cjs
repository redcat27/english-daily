// 比对：三个本地音色 vs 线上返回，确认线上用的是哪一个
const fs = require('fs');
const crypto = require('crypto');
function loadEnv(file){const out={};for(const l of fs.readFileSync(file,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if(v.startsWith('"')||v.startsWith("'")){const q=v[0];const i=v.indexOf(q,1);v=i>0?v.slice(1,i):v.slice(1);}else{const h=v.indexOf(' #');v=h>=0?v.slice(0,h).trim():v;}if(v)out[k]=v;}return out;}
const env = loadEnv('.env');
const BASE = env.MINIMAX_BASE_URL;
const KEY = env.MINIMAX_API_KEY;
const TEXT = 'Good morning. Could I have the bill, please?';
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

(async () => {
  for (const v of ['English_expressive_narrator', 'English_ThoughtfulMan', 'American_narrator']) {
    const r = await fetch(BASE + '/v1/t2a_v2', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.MINIMAX_TTS_MODEL || 'speech-2.8-turbo',
        text: TEXT, stream: false,
        voice_setting: { voice_id: v, speed: Number(env.MINIMAX_VOICE_SPEED || 0.85), vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
      })
    });
    const d = await r.json().catch(() => ({}));
    const hex = d?.data?.audio || '';
    const buf = hex && /^[0-9a-f]+$/i.test(hex) ? Buffer.from(hex, 'hex') : Buffer.from(hex, 'base64');
    console.log(`本地 ${v.padEnd(28)} ${String(buf.length).padStart(6)}B  ${hash(buf)}`);
  }
  const live = await fetch('https://english.lulunote.top/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: TEXT })
  });
  const ab = Buffer.from(await live.arrayBuffer());
  console.log(`线上 ${'(部署版)'.padEnd(28)} ${String(ab.length).padStart(6)}B  ${hash(ab)}`);
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
