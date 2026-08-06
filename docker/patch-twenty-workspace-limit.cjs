#!/usr/bin/env node
/**
 * Remove Twenty's free-tier workspace cap (default 5 without ENTERPRISE_KEY).
 *
 * Voxly is multi-tenant SaaS: each customer gets a Twenty workspace. Upstream
 * `assertWorkspaceCountWithinLimit` in sign-in-up.service.js blocks the 6th
 * SignUpInNewWorkspace with FORBIDDEN_EXCEPTION.
 *
 * Patch raises MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY so self-hosted multi-tenant
 * works without a paid Twenty enterprise JWT.
 *
 * Safe to re-run.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '/* voxly-workspace-limit */';
const CONST_REL =
  'engine/core-modules/auth/constants/max-workspaces-without-enterprise-key.constants.js';

/** High enough for SaaS; still a number so upstream comparisons stay valid. */
const NEW_LIMIT = 100000;

function patchConstants(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(MARKER) && src.includes(`= ${NEW_LIMIT}`)) {
    console.log('already patched:', path.basename(filePath));
    return false;
  }

  const next = src.replace(
    /const MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = \d+;/,
    `${MARKER}\nconst MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = ${NEW_LIMIT};`,
  );

  if (next === src) {
    console.error('pattern not found:', filePath);
    process.exit(1);
  }

  fs.writeFileSync(filePath, next);
  console.log('patched limit →', NEW_LIMIT, ':', filePath);
  return true;
}

function main() {
  const root =
    process.env.TWENTY_SERVER_DIST || '/app/packages/twenty-server/dist';
  const filePath = path.join(root, CONST_REL);
  if (!fs.existsSync(filePath)) {
    console.error('constants file missing:', filePath);
    process.exit(1);
  }
  patchConstants(filePath);
}

main();
