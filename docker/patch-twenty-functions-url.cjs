#!/usr/bin/env node
/**
 * Patch Twenty front so local multiworkspace logic-function URLs use
 * http://{subdomain}.localhost:PORT/s instead of http://localhost:PORT/s.
 *
 * Without this, RestApiClient / hostFetch allowlist only bare localhost, and
 * /s/* on bare Host returns WORKSPACE_NOT_FOUND.
 *
 * Safe to re-run. No-op if already patched or publicFunctionDomain cloud path used.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '/* voxly-functions-url-subdomain */';
const OLD =
  's=({serverBaseUrl:t,publicFunctionDomain:r,workspaceSubdomain:o})=>(0,a.isNonEmptyString)(r)&&(0,a.isNonEmptyString)(o)?`https://${o}.${r}`:`${t}/s`';
const NEW = `${MARKER}s=({serverBaseUrl:t,publicFunctionDomain:r,workspaceSubdomain:o})=>{if((0,a.isNonEmptyString)(r)&&(0,a.isNonEmptyString)(o))return\`https://\${o}.\${r}\`;if((0,a.isNonEmptyString)(o)&&/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:|\\/|$)/.test(t))return t.replace(/^(https?:\\/\\/)(localhost|127\\.0\\.0\\.1)/,\`\$1\${o}.\$2\`).replace(/\\/$/,\"\")+\"/s\";return\`\${t}/s\`}`;

function patchFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(MARKER)) {
    console.log('already patched:', filePath);
    return false;
  }
  if (!src.includes(OLD)) {
    console.log('pattern not found (skip):', filePath);
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
    if (!/^useGetLogicFunctionHttpUrl-.*\.js$/.test(name)) continue;
    if (patchFile(path.join(root, name))) n += 1;
  }
  console.log('done, files patched:', n);
}

main();
