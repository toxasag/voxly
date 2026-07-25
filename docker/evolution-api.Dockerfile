# Evolution API with WhatsApp @lid send bypass (PR #2544).
# Stock v2.2.3 rejects DMs to Linked ID peers with exists:false → HTTP 400.
# tsup emits the Baileys service into many dist chunks — patch every copy.
FROM evoapicloud/evolution-api:v2.2.3

RUN node -e "\
const fs=require('fs'); const path=require('path');\
function walk(dir, acc=[]) {\
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {\
    const p=path.join(dir,ent.name);\
    if (ent.isDirectory()) { if (ent.name==='node_modules'||ent.name==='instances') continue; walk(p,acc); }\
    else if (/\\.(js|mjs|cjs)$/.test(ent.name)) acc.push(p);\
  }\
  return acc;\
}\
const from='!n.jid.includes(\"@broadcast\")';\
const to='!n.jid.includes(\"@broadcast\")&&!n.jid.includes(\"@lid\")';\
const from2='!s.jid.includes(\"@broadcast\")';\
const to2='!s.jid.includes(\"@broadcast\")&&!s.jid.includes(\"@lid\")';\
let patched=0;\
for (const f of walk('/evolution/dist')) {\
  let s=fs.readFileSync(f,'utf8');\
  if (!s.includes(from) && !s.includes(from2)) continue;\
  const before=s;\
  s=s.split(from).join(to);\
  s=s.split(from2).join(to2);\
  if (s!==before) { fs.writeFileSync(f,s); patched++; }\
}\
if (patched<1) throw new Error('LID patch matched 0 files');\
console.log('LID-patched files:', patched);\
"
