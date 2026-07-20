/**
 * Telegram client Markdown (what users type in Telegram) → Bot API MarkdownV2.
 *
 * Client syntax:
 *   **bold**  __italic__  ~~strike~~  ||spoiler||  `code`  ```block```
 *
 * Bot API MarkdownV2 uses different markers (*bold*, _italic_, ~strike~),
 * so we parse then re-emit with proper escaping.
 */

export type TgMdNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: TgMdNode[] }
  | { type: 'italic'; children: TgMdNode[] }
  | { type: 'strike'; children: TgMdNode[] }
  | { type: 'spoiler'; children: TgMdNode[] }
  | { type: 'code'; value: string }
  | { type: 'pre'; value: string };

export const TELEGRAM_CLIENT_MD_HINT =
  '**жирный**, __курсив__, ~~зачёркнутый~~, ||спойлер||, `код`, ```блок```';

const MDV2_SPECIAL = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

function escapeMdV2(text: string): string {
  return text.replace(MDV2_SPECIAL, '\\$1');
}

function escapeMdV2Code(text: string): string {
  return text.replace(/([`\\])/g, '\\$1');
}

function findClosing(src: string, from: number, marker: string): number {
  return src.indexOf(marker, from);
}

/** Parse Telegram client Markdown into a lightweight AST. */
export function parseTelegramClientMd(src: string): TgMdNode[] {
  return parseFormatted(src);
}

function parseFormatted(src: string): TgMdNode[] {
  const nodes: TgMdNode[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (textBuf) {
      nodes.push({ type: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < src.length) {
    if (src.startsWith('```', i)) {
      const end = findClosing(src, i + 3, '```');
      if (end !== -1) {
        flushText();
        let body = src.slice(i + 3, end);
        if (body.startsWith('\n')) body = body.slice(1);
        if (body.endsWith('\n')) body = body.slice(0, -1);
        nodes.push({ type: 'pre', value: body });
        i = end + 3;
        continue;
      }
    }

    if (src[i] === '`') {
      const end = findClosing(src, i + 1, '`');
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'code', value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (src.startsWith('**', i)) {
      const end = findClosing(src, i + 2, '**');
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'bold', children: parseFormatted(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (src.startsWith('__', i)) {
      const end = findClosing(src, i + 2, '__');
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'italic', children: parseFormatted(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (src.startsWith('~~', i)) {
      const end = findClosing(src, i + 2, '~~');
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'strike', children: parseFormatted(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (src.startsWith('||', i)) {
      const end = findClosing(src, i + 2, '||');
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'spoiler', children: parseFormatted(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    textBuf += src[i];
    i += 1;
  }

  flushText();
  return nodes;
}

function nodesToMarkdownV2(nodes: TgMdNode[]): string {
  return nodes.map(nodeToMarkdownV2).join('');
}

function nodeToMarkdownV2(node: TgMdNode): string {
  switch (node.type) {
    case 'text':
      return escapeMdV2(node.value);
    case 'bold':
      return `*${nodesToMarkdownV2(node.children)}*`;
    case 'italic':
      return `_${nodesToMarkdownV2(node.children)}_`;
    case 'strike':
      return `~${nodesToMarkdownV2(node.children)}~`;
    case 'spoiler':
      return `||${nodesToMarkdownV2(node.children)}||`;
    case 'code':
      return `\`${escapeMdV2Code(node.value)}\``;
    case 'pre':
      return `\`\`\`\n${escapeMdV2Code(node.value)}\n\`\`\``;
    default:
      return '';
  }
}

/** Convert Telegram client Markdown to Bot API MarkdownV2 text. */
export function clientMdToMarkdownV2(input: string): string {
  if (!input) return '';
  return nodesToMarkdownV2(parseTelegramClientMd(input));
}
