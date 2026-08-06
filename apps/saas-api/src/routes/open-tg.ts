/**
 * Public HTTPS bridge → tg://user?id=…
 * Twenty LINKS UI only clicks http(s); raw tg:// is mangled by ensureAbsoluteUrl.
 * Only numeric MTProto user ids are accepted (no open-redirect).
 */
import type { FastifyInstance } from 'fastify';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function openTgRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { userId: string } }>('/tg/:userId', async (request, reply) => {
    const userId = String(request.params.userId || '').trim();
    if (!/^\d{1,20}$/.test(userId)) {
      return reply.code(400).type('text/plain').send('Invalid Telegram user id');
    }
    const deep = `tg://user?id=${userId}`;
    const safe = escapeHtml(deep);
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="refresh" content="0;url=${safe}"/>
  <title>Открыть в Telegram</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.45;color:#1a1a1a}
    a{color:#2aabee;font-weight:600}
  </style>
</head>
<body>
  <p>Открываем контакт в Telegram…</p>
  <p><a href="${safe}">Нажмите здесь, если не открылось</a></p>
  <script>location.replace(${JSON.stringify(deep)});</script>
</body>
</html>`;
    return reply
      .header('Cache-Control', 'public, max-age=300')
      .type('text/html; charset=utf-8')
      .send(html);
  });
}
