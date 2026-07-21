#!/usr/bin/env node
/**
 * Patch Twenty FrontComponentRenderer so file-input change events include
 * `dataBase64` for each file (host-side FileReader), not metadata alone.
 *
 * Upstream (PR #20458) only forwards {name,size,type,lastModified}. Remote DOM
 * File proxies are plain objects — not Blobs — so worker FileReader/arrayBuffer
 * always fail (INC-015 / INC-017).
 *
 * Images are JPEG-downscaled on the host so each /reply JSON stays under Nest's
 * 10MB body limit (oversize → HTTP 500 "request entity too large", INC-020).
 *
 * Safe to re-run. Replaces a previous voxly-file-base64 patch if present.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '/* voxly-file-base64 */';
const OLD = 'a4=e=>n=>{e(i4(n))}';

// Host has real File/Blob on n.target.files; read+compress async then forward.
// Note: Promise.all( map( new Promise(...) ) ) needs THREE closing parens before .then (INC-018).
const NEW =
  MARKER +
  'a4=e=>n=>{const f=n&&n.target&&n.target.files;if(f&&f.length){const s=i4(n);const maxEdge=1600;const maxB64=7e6;const toB64=u=>{const c=u.indexOf(",");return c>=0?u.slice(c+1):u};const shrink=async(file,dataUrl)=>{const mime=(file.type||"").toLowerCase();if(!mime.startsWith("image/")||mime.includes("svg"))return{b64:toB64(dataUrl),type:file.type||"",name:file.name};try{const img=await new Promise((res,rej)=>{const i=new Image;i.onload=()=>res(i);i.onerror=()=>rej(new Error("img"));i.src=dataUrl});let w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)return{b64:toB64(dataUrl),type:file.type||"",name:file.name};const scale=Math.min(1,maxEdge/Math.max(w,h));w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale));const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d");if(!ctx)return{b64:toB64(dataUrl),type:file.type||"",name:file.name};ctx.drawImage(img,0,0,w,h);let q=0.82,out=canvas.toDataURL("image/jpeg",q),b64=toB64(out);while(b64.length>maxB64&&q>0.45){q-=0.12;out=canvas.toDataURL("image/jpeg",q);b64=toB64(out)}const base=(file.name||"image").replace(/\\.[^.]+$/,"");return{b64,type:"image/jpeg",name:base+".jpg"}}catch(err){return{b64:toB64(dataUrl),type:file.type||"",name:file.name}}};Promise.all(Array.from(f).map((file,idx)=>new Promise((resolve,reject)=>{const meta=(s.files&&s.files[idx])||{name:file.name,size:file.size,type:file.type||"",lastModified:file.lastModified||0};const r=new FileReader;r.onload=()=>{const u=r.result;if(typeof u!=="string"){reject(new Error("empty"));return}Promise.resolve(shrink(file,u)).then(p=>resolve(Object.assign({},meta,{name:p.name||meta.name,type:p.type||meta.type,dataBase64:p.b64,size:Math.floor((p.b64.length*3)/4)}))).catch(reject)};r.onerror=()=>reject(r.error||new Error("read fail"));try{r.readAsDataURL(file)}catch(err){reject(err)}}))).then(list=>{s.files=list;e(s)}).catch(err=>{console.error("voxly-file-base64",err);e(s)});return}e(i4(n))}';

function stripExistingPatch(src) {
  if (!src.includes(MARKER)) return src;
  // Remove from marker through the patched a4 assignment (ends before `,o4=` or similar).
  return src.replace(
    /\/\* voxly-file-base64 \*\/a4=e=>n=>\{[\s\S]*?\},(?=o4=)/,
    'a4=e=>n=>{e(i4(n))},',
  );
}

function patchFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  const hadMarker = src.includes(MARKER);
  src = stripExistingPatch(src);
  if (!src.includes(OLD)) {
    console.log(
      hadMarker
        ? 'strip ok but pattern missing after revert (skip):'
        : 'pattern not found (skip):',
      filePath,
    );
    return false;
  }
  const next = src.replace(OLD, NEW);
  if (next === src) {
    console.log('replace failed:', filePath);
    return false;
  }
  fs.writeFileSync(filePath, next);
  console.log(hadMarker ? 're-patched:' : 'patched:', filePath);
  return true;
}

function main() {
  const root =
    process.env.TWENTY_FRONT_ASSETS ||
    '/app/packages/twenty-server/dist/front/assets';
  if (!fs.existsSync(root)) {
    console.error('assets dir missing:', root);
    process.exit(1);
  }
  let n = 0;
  for (const name of fs.readdirSync(root)) {
    if (!/^FrontComponentRenderer-.*\.js$/.test(name)) continue;
    if (patchFile(path.join(root, name))) n += 1;
  }
  console.log('done, files patched:', n);
  if (n === 0) {
    // Soft fail: image may use a different minify shape; chat still degrades gracefully.
    process.exitCode = 0;
  }
}

main();
