/** Minimal Telegram-client Markdown AST (no @voxly/shared dep in Twenty app). */

export type TgMdNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: TgMdNode[] }
  | { type: 'italic'; children: TgMdNode[] }
  | { type: 'strike'; children: TgMdNode[] }
  | { type: 'spoiler'; children: TgMdNode[] }
  | { type: 'code'; value: string }
  | { type: 'pre'; value: string };

export const TELEGRAM_CLIENT_MD_HINT =
  '**жирный**, __курсив__, ~~зачёркнутый~~, ||спойлер||, `код`';

function findClosing(src: string, from: number, marker: string): number {
  return src.indexOf(marker, from);
}

export function parseTelegramClientMd(src: string): TgMdNode[] {
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
        nodes.push({
          type: 'bold',
          children: parseTelegramClientMd(src.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('__', i)) {
      const end = findClosing(src, i + 2, '__');
      if (end !== -1) {
        flushText();
        nodes.push({
          type: 'italic',
          children: parseTelegramClientMd(src.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('~~', i)) {
      const end = findClosing(src, i + 2, '~~');
      if (end !== -1) {
        flushText();
        nodes.push({
          type: 'strike',
          children: parseTelegramClientMd(src.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('||', i)) {
      const end = findClosing(src, i + 2, '||');
      if (end !== -1) {
        flushText();
        nodes.push({
          type: 'spoiler',
          children: parseTelegramClientMd(src.slice(i + 2, end)),
        });
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

export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
): { text: string; nextStart: number; nextEnd: number } {
  const selected = value.slice(start, end);
  const text =
    value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    text,
    nextStart: start + before.length,
    nextEnd: end + before.length,
  };
}
