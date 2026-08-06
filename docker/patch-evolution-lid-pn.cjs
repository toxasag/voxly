#!/usr/bin/env node
/**
 * Voxly patch (INC-097 v8): expose Baileys lidMapping PN on @lid peers.
 * Enriches fetchProfile + fetchChats (findChats) with remoteJidAlt/senderPn
 * from signalRepository.lidMapping.getPNForLID, then Redis instance hash
 * `lid-mapping-{lid}_reverse` via this.cache / this.baileysCache when
 * in-memory mapping is empty (historical peers).
 *
 * findChats: patch whatsapp.baileys.service.mjs (yp/minifier guard) + controller
 * wrapper (belt-and-suspenders). Earlier v8 only patched main.mjs (dm guard) —
 * not the runtime module.
 *
 * Safe to re-run: upgrades earlier voxly-lid-pn blocks.
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'voxly-lid-pn';
const CHATS_MARKER = 'voxly-lid-pn-chats';
const CTRL_MARKER = 'voxly-lid-pn-ctrl';

const FETCH_PROFILE_FROM =
  'return{wuid:n?.jid||o,name:n?.name,numberExists:n?.exists,picture:r?.profilePictureUrl,status:a?.status,isBusiness:c.isBusiness,email:c?.email,description:c?.description,website:c?.website?.shift()}';

const REDIS_FALLBACK =
  'if(!_vxPn&&this.cache&&this.instanceId){const _d=_j.split("@")[0],_r=await this.cache.hGet(this.instanceId,`lid-mapping-${_d}_reverse`);let _pn=_r!=null?String(_r).replace(/\\D/g,""):"";/^\\d{10,15}$/.test(_pn)&&(_vxPn=`${_pn}@s.whatsapp.net`)}';

const REDIS_BAILEYS_FALLBACK =
  'if(!_vxPn&&this.baileysCache&&this.instanceId){const _d=_j.split("@")[0],_r=await this.baileysCache.hGet(this.instanceId,`lid-mapping-${_d}_reverse`);let _pn=_r!=null?String(_r).replace(/"/g,"").trim().replace(/\\D/g,""):"";/^\\d{10,15}$/.test(_pn)&&(_vxPn=`${_pn}@s.whatsapp.net`)}';

const FETCH_PROFILE_V2 = `/*${MARKER}*/let _vxPn;try{const _j=n?.jid||o;if(_j?.endsWith?.("@lid")){if(this.client?.signalRepository?.lidMapping?.getPNForLID){const _p=await this.client.signalRepository.lidMapping.getPNForLID(_j);_p&&!String(_p).includes("@lid")&&(_vxPn=String(_p).includes("@s.whatsapp.net")?_p:\`\${String(_p).replace(/\\D/g,"")}@s.whatsapp.net\`)}${REDIS_FALLBACK}${REDIS_BAILEYS_FALLBACK}}}catch{}return{wuid:n?.jid||o,remoteJidAlt:_vxPn,senderPn:_vxPn,`;

const FETCH_PROFILE_V1_BAILEYS =
  `/*${MARKER}*/let _vxPn;try{const _j=n?.jid||o;if(_j?.endsWith?.("@lid")){if(this.client?.signalRepository?.lidMapping?.getPNForLID){const _p=await this.client.signalRepository.lidMapping.getPNForLID(_j);_p&&!String(_p).includes("@lid")&&(_vxPn=String(_p).includes("@s.whatsapp.net")?_p:\`\${String(_p).replace(/\\D/g,"")}@s.whatsapp.net\`)}if(!_vxPn&&this.baileysCache&&this.instanceId){const _d=_j.split("@")[0],_r=await this.baileysCache.hGet(this.instanceId,\`lid-mapping-\${_d}_reverse\`);let _pn=_r?String(_r).replace(/"/g,"").trim():"";/^\\d{10,15}$/.test(_pn)&&(_vxPn=\`\${_pn}@s.whatsapp.net\`)}}}catch{}return{wuid:n?.jid||o,remoteJidAlt:_vxPn,senderPn:_vxPn,`;

const FETCH_PROFILE_V1_MEM =
  `/*${MARKER}*/let _vxPn;try{if((n?.jid||o)?.endsWith?.("@lid")&&this.client?.signalRepository?.lidMapping?.getPNForLID){const _p=await this.client.signalRepository.lidMapping.getPNForLID(n?.jid||o);_p&&!String(_p).includes("@lid")&&(_vxPn=_p)}}catch{}return{wuid:n?.jid||o,remoteJidAlt:_vxPn,senderPn:_vxPn,`;

const FETCH_CHATS_LASTMSG =
  'let l=c.lastMessageId?{id:c.lastMessageId,key:c.lastMessage_key,pushName:c.lastMessagePushName,participant:c.lastMessageParticipant,messageType:c.lastMessageMessageType,message:c.lastMessageMessage,contextInfo:c.lastMessageContextInfo,source:c.lastMessageSource,messageTimestamp:c.lastMessageMessageTimestamp,instanceId:c.lastMessageInstanceId,sessionId:c.lastMessageSessionId,status:c.lastMessageStatus}:void 0';

const ENRICH_LID_BLOCK = `let _vxAlt,_vxPn;try{const _j=c.remoteJid;if(_j?.endsWith?.("@lid")){if(this.client?.signalRepository?.lidMapping?.getPNForLID){const _p=await this.client.signalRepository.lidMapping.getPNForLID(_j);_p&&!String(_p).includes("@lid")&&(_vxAlt=String(_p).includes("@s.whatsapp.net")?_p:\`\${String(_p).replace(/\\D/g,"")}@s.whatsapp.net\`,_vxPn=_vxAlt)}if(!_vxPn&&this.cache&&this.instanceId){const _d=_j.split("@")[0],_r=await this.cache.hGet(this.instanceId,\`lid-mapping-\${_d}_reverse\`);let _pn=_r!=null?String(_r).replace(/\\D/g,""):"";/^\\d{10,15}$/.test(_pn)&&(_vxAlt=_vxPn=\`\${_pn}@s.whatsapp.net\`)}if(!_vxPn&&this.baileysCache&&this.instanceId){const _d=_j.split("@")[0],_r=await this.baileysCache.hGet(this.instanceId,\`lid-mapping-\${_d}_reverse\`);let _pn=_r!=null?String(_r).replace(/"/g,"").trim().replace(/\\D/g,""):"";/^\\d{10,15}$/.test(_pn)&&(_vxAlt=_vxPn=\`\${_pn}@s.whatsapp.net\`)}}}catch{}`;

const FETCH_CHATS_V3 = `;/*${CHATS_MARKER}*/if(Array.isArray(r)&&r.length>0){const _vxOut=[];for(const c of r){${ENRICH_LID_BLOCK};${FETCH_CHATS_LASTMSG};_vxOut.push({id:c.contactId||null,remoteJid:c.remoteJid,remoteJidAlt:_vxAlt,senderPn:_vxPn,pushName:c.pushName,profilePicUrl:c.profilePicUrl,updatedAt:c.updatedAt,windowStart:c.windowStart,windowExpires:c.windowExpires,windowActive:c.windowActive,lastMessage:l?this.cleanMessageData(l):void 0,unreadCount:c.unreadMessages,isSaved:!!c.contactId})}return _vxOut}return[]`;

// Runtime module uses yp(r); stale main.mjs bundle used dm(r).
const FETCH_CHATS_RETURN_RE =
  /`;return r&&\w+\(r\)&&r\.length>0\?r\.map\(c=>\{let l=c\.lastMessageId\?[\s\S]*?isSaved:!!c\.contactId\}\}\):\[\]/;

const FETCH_CHATS_BROKEN_RE =
  /`;\/\*voxly-lid-pn\*\/if\(r&&\w+\(r\)&&r\.length>0\)\{return Promise\.all\(r\.map\(async c=>\{[\s\S]*?isSaved:!!c\.contactId\}\)\)\}return\[\]/;

const FETCH_CHATS_CTRL_FROM =
  'async fetchChats({instanceName:s},e){return await this.waMonitor.waInstances[s].fetchChats(e)}';

const FETCH_CHATS_CTRL_TO = `async fetchChats({instanceName:s},e){/*${CTRL_MARKER}*/const _vxR=await this.waMonitor.waInstances[s].fetchChats(e);if(!Array.isArray(_vxR))return _vxR;const _vxI=this.waMonitor.waInstances[s];for(const _vxC of _vxR){try{const _vxJ=_vxC?.remoteJid;if(!_vxJ?.endsWith?.("@lid"))continue;let _vxPn;if(_vxI?.client?.signalRepository?.lidMapping?.getPNForLID){const _vxP=await _vxI.client.signalRepository.lidMapping.getPNForLID(_vxJ);_vxP&&!String(_vxP).includes("@lid")&&(_vxPn=String(_vxP).includes("@s.whatsapp.net")?_vxP:\`\${String(_vxP).replace(/\\D/g,"")}@s.whatsapp.net\`)}if(!_vxPn&&_vxI?.cache&&_vxI?.instanceId){const _vxD=_vxJ.split("@")[0],_vxRv=await _vxI.cache.hGet(_vxI.instanceId,\`lid-mapping-\${_vxD}_reverse\`);let _vxN=_vxRv!=null?String(_vxRv).replace(/\\D/g,""):"";/^\\d{10,15}$/.test(_vxN)&&(_vxPn=\`\${_vxN}@s.whatsapp.net\`)}if(!_vxPn&&_vxI?.baileysCache&&_vxI?.instanceId){const _vxD=_vxJ.split("@")[0],_vxRv=await _vxI.baileysCache.hGet(_vxI.instanceId,\`lid-mapping-\${_vxD}_reverse\`);let _vxN=_vxRv!=null?String(_vxRv).replace(/"/g,"").trim().replace(/\\D/g,""):"";/^\\d{10,15}$/.test(_vxN)&&(_vxPn=\`\${_vxN}@s.whatsapp.net\`)}if(_vxPn){_vxC.remoteJidAlt=_vxPn;_vxC.senderPn=_vxPn}}catch{}}return _vxR}`;

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'instances') continue;
      walk(p, acc);
    } else if (/\.(js|mjs|cjs)$/.test(ent.name)) {
      acc.push(p);
    }
  }
  return acc;
}

let profilePatched = 0;
let chatsPatched = 0;
let chatsUpgraded = 0;
let chatsCtrlPatched = 0;
let profileUpgraded = 0;

for (const file of walk('/evolution/dist')) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;

  if (s.includes(FETCH_PROFILE_V1_BAILEYS)) {
    s = s.split(FETCH_PROFILE_V1_BAILEYS).join(FETCH_PROFILE_V2);
    profileUpgraded += 1;
  } else if (s.includes(FETCH_PROFILE_V1_MEM)) {
    s = s.split(FETCH_PROFILE_V1_MEM).join(FETCH_PROFILE_V2);
    profileUpgraded += 1;
  } else if (!s.includes(MARKER) && s.includes(FETCH_PROFILE_FROM)) {
    s = s.split(FETCH_PROFILE_FROM).join(
      FETCH_PROFILE_V2 +
        'name:n?.name,numberExists:n?.exists,picture:r?.profilePictureUrl,status:a?.status,isBusiness:c.isBusiness,email:c?.email,description:c?.description,website:c?.website?.shift()}',
    );
    profilePatched += 1;
  }

  if (FETCH_CHATS_BROKEN_RE.test(s)) {
    s = s.replace(FETCH_CHATS_BROKEN_RE, FETCH_CHATS_V3);
    chatsUpgraded += 1;
  } else if (!s.includes(CHATS_MARKER) && FETCH_CHATS_RETURN_RE.test(s)) {
    s = s.replace(FETCH_CHATS_RETURN_RE, FETCH_CHATS_V3);
    chatsPatched += 1;
  }

  if (!s.includes(CTRL_MARKER) && s.includes(FETCH_CHATS_CTRL_FROM)) {
    s = s.split(FETCH_CHATS_CTRL_FROM).join(FETCH_CHATS_CTRL_TO);
    chatsCtrlPatched += 1;
  }

  if (s !== before) {
    fs.writeFileSync(file, s);
  }
}

const total = profilePatched + chatsPatched + chatsUpgraded + chatsCtrlPatched + profileUpgraded;
if (total < 1) {
  throw new Error(
    `${MARKER}: matched 0 targets (profile=${profilePatched}, chats=${chatsPatched}, chatsUpgraded=${chatsUpgraded}, ctrl=${chatsCtrlPatched}, upgraded profile=${profileUpgraded})`,
  );
}

console.log(
  `${MARKER}: fetchProfile patches=${profilePatched}, fetchChats patches=${chatsPatched}, fetchChats upgraded=${chatsUpgraded}, controller=${chatsCtrlPatched}, upgraded profile=${profileUpgraded}`,
);
