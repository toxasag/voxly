#!/usr/bin/env node
/**
 * Patch Twenty front so FrontComponent module URLs use the current page origin
 * (`{location.origin}/rest/front-components/...`) instead of SERVER_URL (app.*).
 *
 * On custom domains ({slug}-crm.getvoxly.ru) absolute app.getvoxly.ru URLs drop
 * workspace session cookies → 403/404 and "FrontComponent error: Failed to fetch".
 *
 * Safe to re-run. No-op if already patched or pattern missing.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '/* voxly-front-component-same-origin */';
const OLD =
  'R4=({frontComponentId:e,checksum:n})=>We(n)?`${wr}/front-components/${e}/${n}.js`:`${wr}/front-components/${e}`';
const NEW =
  `${MARKER}R4=({frontComponentId:e,checksum:n})=>{const b=(typeof location!=="undefined"&&location.origin)?(location.origin+"/rest"):wr;return We(n)?\`\${b}/front-components/\${e}/\${n}.js\`:\`\${b}/front-components/\${e}\`}`;

function patchFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(MARKER)) {
    console.log('already patched:', filePath);
    return false;
  }
  if (!src.includes(OLD)) {
    console.log('pattern not found (skip):', path.basename(filePath));
    return false;
  }
  fs.writeFileSync(filePath, src.replace(OLD, NEW));
  console.log('patched:', filePath);
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
  // Fallback: scan all assets if chunk hash/name differs
  if (n === 0) {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith('.js')) continue;
      const full = path.join(root, name);
      const src = fs.readFileSync(full, 'utf8');
      if (src.includes(OLD) && patchFile(full)) n += 1;
    }
  }
  console.log('done, files patched:', n);
  if (n === 0) process.exitCode = 1;
}

main();
