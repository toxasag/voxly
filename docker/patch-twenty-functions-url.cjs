#!/usr/bin/env node
/**
 * Patch Twenty `useGetLogicFunctionHttpUrl` so /s/* hits the workspace host:
 *
 * - Prefer `location.origin/s` when the CRM SPA runs on a custom domain
 *   ({slug}-crm.getvoxly.ru). SERVER_URL=app.* → /s returns WORKSPACE_NOT_FOUND.
 * - Keep localhost multiworkspace: http://{sub}.localhost:PORT/s
 * - Cloud publicFunctionDomain path unchanged
 *
 * Safe to re-run.
 */
const fs = require('fs');
const path = require('path');

const MARKER_V2 = '/* voxly-functions-url-v2 */';
const MARKER_V1 = '/* voxly-functions-url-subdomain */';

const STOCK =
  's=({serverBaseUrl:t,publicFunctionDomain:r,workspaceSubdomain:o})=>(0,a.isNonEmptyString)(r)&&(0,a.isNonEmptyString)(o)?`https://${o}.${r}`:`${t}/s`';

const NEW =
  `${MARKER_V2}s=({serverBaseUrl:t,publicFunctionDomain:r,workspaceSubdomain:o})=>{if((0,a.isNonEmptyString)(r)&&(0,a.isNonEmptyString)(o))return\`https://\${o}.\${r}\`;if(typeof location!=="undefined"&&location.origin)return location.origin+"/s";if((0,a.isNonEmptyString)(o)&&/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:|\\/|$)/.test(t))return t.replace(/^(https?:\\/\\/)(localhost|127\\.0\\.0\\.1)/,\`\$1\${o}.\$2\`).replace(/\\/$/,\"\")+\"/s\";return\`\${t}/s\`}`;

function patchFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');

  if (src.includes(MARKER_V2) && src.includes('location.origin+"/s"')) {
    console.log('already patched v2:', path.basename(filePath));
    return false;
  }

  // Remove v1 marker block if present (replace whole helper starting at marker)
  if (src.includes(MARKER_V1)) {
    const start = src.indexOf(MARKER_V1);
    // Find end of the arrow/function we inserted — ends at first `}` after return `${t}/s`
    const from = src.slice(start);
    const endRel = from.search(/return`\$\{t\}\/s`\}/);
    if (endRel !== -1) {
      const end = start + endRel + 'return`${t}/s`}'.length;
      src = src.slice(0, start) + NEW + src.slice(end);
      fs.writeFileSync(filePath, src);
      console.log('upgraded v1→v2:', path.basename(filePath));
      return true;
    }
  }

  if (src.includes(STOCK)) {
    fs.writeFileSync(filePath, src.replace(STOCK, NEW));
    console.log('patched stock→v2:', path.basename(filePath));
    return true;
  }

  console.log('pattern not found (skip):', path.basename(filePath));
  return false;
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
  const names = fs.readdirSync(root).filter((name) => name.endsWith('.js'));
  for (const name of names) {
    if (!/^useGetLogicFunctionHttpUrl-/.test(name)) continue;
    if (patchFile(path.join(root, name))) n += 1;
  }
  if (n === 0) {
    for (const name of names) {
      const full = path.join(root, name);
      const src = fs.readFileSync(full, 'utf8');
      if (src.includes(STOCK) || src.includes(MARKER_V1)) {
        if (patchFile(full)) n += 1;
      }
    }
  }

  console.log('done, files patched:', n);
  const ok = names.some((name) =>
    fs.readFileSync(path.join(root, name), 'utf8').includes('location.origin+"/s"'),
  );
  if (!ok) process.exitCode = 1;
}

main();
