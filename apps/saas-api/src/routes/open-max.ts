/**
 * Public HTTPS bridge for MAX user id when PyMax has no public max.ru link.
 * Twenty LINKS only clicks http(s). Only numeric user ids accepted.
 */
import type { FastifyInstance } from 'fastify';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function openMaxRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { userId: string } }>('/max/:userId', async (request, reply) => {
    const userId = String(request.params.userId || '').trim();
    if (!/^\d{1,20}$/.test(userId)) {
      return reply.code(400).type('text/plain').send('Invalid MAX user id');
    }
    // Best-effort deep link; web fallback max.ru.
    const deep = `max://user?id=${userId}`;
    const web = 'https://max.ru/';
    const safeDeep = escapeHtml(deep);
    const safeWeb = escapeHtml(web);
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Открыть в MAX</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.45;color:#1a1a1a}
    a{color:#0a7cff;font-weight:600}
    code{font-size:0.9em;background:#f4f4f4;padding:0.1em 0.35em;border-radius:4px}
  </style>
</head>
<body>
  <p>Контакт в MAX · id <code>${escapeHtml(userId)}</code></p>
  <p><a href="${safeDeep}">Открыть в приложении MAX</a></p>
  <p><a href="${safeWeb}">Открыть max.ru</a></p>
  <script>try{location.replace(${JSON.stringify(deep)});}catch(e){}</script>
</body>
</html>`;
    return reply
      .header('Cache-Control', 'public, max-age=300')
      .type('text/html; charset=utf-8')
      .send(html);
  });
}
