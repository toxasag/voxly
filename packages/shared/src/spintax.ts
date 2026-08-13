/**
 * Spintax (Job 1C.1): `{вариант1|вариант2}` groups in mailing text.
 * Each broadcast recipient gets its own random variant; the UI shows a preview.
 *
 * Supported: nested groups (`{A|{B|C}}`, innermost expanded first) and
 * escaping — `\|` inside a group is a literal pipe, `\{`/`\}` are literal braces
 * inside a group. Outside groups, escapes are also honoured.
 */

const GROUP_RE = /(?<!\\)\{((?:[^{}]|\\.)*)(?<!\\)\}/;
const GROUP_GLOBAL_RE = /(?<!\\)\{[^{}]*\}/g;
const PIPE_RE = /(?<!\\)\|/;
const ESCAPE_RE = /\\([{}|])/g;

/** Count of innermost spintax groups in the text (0 = plain text). */
export function spintaxGroupsCount(text: string): number {
  return text.match(GROUP_GLOBAL_RE)?.length ?? 0;
}

/** Expand one innermost `{a|b|c}` group into a random variant. */
function expandOneGroup(text: string, rng: () => number): string {
  return text.replace(GROUP_RE, (_match, inner: string) => {
    const variants = inner.split(PIPE_RE);
    return variants[Math.floor(rng() * variants.length)];
  });
}

/**
 * Random expansion of all spintax groups (nested supported, innermost first).
 * Injected `rng` (0..1) makes tests deterministic.
 */
export function expandSpintax(text: string, rng: () => number = Math.random): string {
  let out = text;
  for (let guard = 0; guard < 50 && GROUP_RE.test(out); guard += 1) {
    out = expandOneGroup(out, rng);
  }
  return out.replace(ESCAPE_RE, '$1');
}

/** Sample expansions for the UI preview (each call re-randomizes). */
export function previewSpintax(text: string, count = 5): string[] {
  const samples: string[] = [];
  for (let i = 0; i < count; i += 1) {
    samples.push(expandSpintax(text));
  }
  return samples;
}
