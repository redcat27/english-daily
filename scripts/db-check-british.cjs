const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { readFileSync } = require('fs');
function loadEnv(file){const out={};for(const l of readFileSync(file,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if(v.startsWith('"')||v.startsWith("'")){const q=v[0];const i=v.indexOf(q,1);v=i>0?v.slice(1,i):v.slice(1);}else{const h=v.indexOf(' #');v=h>=0?v.slice(0,h).trim():v;}if(v)out[k]=v;}return out;}
const env = loadEnv('.env');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const BRITISH = ['colour','favorite','favourite','centre','theatre','metre','neighbour','travelling','organise','realise','apologise','colourful','programme','grey','flavour'];
(async () => {
  const rows = await prisma.dailyLesson.findMany({ select: { date: true, scene: true, payload: true } });
  for (const r of rows) {
    const text = JSON.stringify(r.payload).toLowerCase();
    const hits = BRITISH.filter(w => text.includes(w));
    console.log(`${r.date.toISOString().slice(0,10)} ${r.scene} -> 英式拼写: ${hits.length ? hits.join(',') : '无'}`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
