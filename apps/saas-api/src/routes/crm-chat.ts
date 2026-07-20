// CRM chat: messages + formatted reply + media by Twenty Opportunity or Person id
// Auth: portal JWT or short-lived crm-chat JWT from /api/tenant/crm-login

import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { decrypt } from '@voxly/crypto';
import { clientMdToMarkdownV2 } from '@voxly/shared';
import { TwentyClient } from '@voxly/twenty-client';

type ChatAttachment = {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation';
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

async function findSubscriberForCrmRecord(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  recordId: string,
) {
  return prisma.giftSubscriber.findFirst({
    where: {
      tenantId,
      OR: [{ twentyOpportunityId: recordId }, { twentyPersonId: recordId }],
    },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
  });
}

function canReply(user: { role?: string; tenantRole?: string }): boolean {
  return (
    user.role === 'superadmin' ||
    user.tenantRole === 'owner' ||
    user.tenantRole === 'member' ||
    user.role === 'owner' ||
    user.role === 'member'
  );
}

function detectUploadKind(
  mimeType: string,
  filename: string,
): 'photo' | 'video' | 'document' {
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(filename)) return 'photo';
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(filename)) return 'video';
  return 'document';
}

function mapAttachment(att: unknown): ChatAttachment | null {
  if (!att || typeof att !== 'object') return null;
  const a = att as Record<string, unknown>;
  if (typeof a.fileId !== 'string' || typeof a.type !== 'string') return null;
  return {
    type: a.type as ChatAttachment['type'],
    fileId: a.fileId,
    fileUniqueId: typeof a.fileUniqueId === 'string' ? a.fileUniqueId : undefined,
    fileName: typeof a.fileName === 'string' ? a.fileName : undefined,
    mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
    fileSize: typeof a.fileSize === 'number' ? a.fileSize : undefined,
  };
}

async function sendTelegramText(
  botApi: string,
  chatId: string,
  text: string,
): Promise<void> {
  const tgRes = await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: clientMdToMarkdownV2(text),
      parse_mode: 'MarkdownV2',
    }),
  });
  const tgJson = (await tgRes.json()) as { ok?: boolean; description?: string };
  if (tgJson.ok) return;

  const plain = await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const plainJson = (await plain.json()) as { ok?: boolean; description?: string };
  if (!plainJson.ok) {
    throw new Error(plainJson.description || tgJson.description || 'Telegram send failed');
  }
}

async function sendTelegramMedia(opts: {
  botApi: string;
  chatId: string;
  kind: 'photo' | 'video' | 'document';
  buffer: Buffer;
  filename: string;
  mimeType: string;
  caption?: string;
}): Promise<ChatAttachment> {
  const form = new FormData();
  form.append('chat_id', opts.chatId);
  if (opts.caption) {
    form.append('caption', clientMdToMarkdownV2(opts.caption));
    form.append('parse_mode', 'MarkdownV2');
  }
  const blob = new Blob([new Uint8Array(opts.buffer)], {
    type: opts.mimeType || 'application/octet-stream',
  });
  const field = opts.kind === 'photo' ? 'photo' : opts.kind === 'video' ? 'video' : 'document';
  const method =
    opts.kind === 'photo' ? 'sendPhoto' : opts.kind === 'video' ? 'sendVideo' : 'sendDocument';
  form.append(field, blob, opts.filename);

  let tgRes = await fetch(`${opts.botApi}/${method}`, { method: 'POST', body: form });
  let tgJson = (await tgRes.json()) as any;
  if (!tgJson.ok && opts.caption) {
    // Retry without MarkdownV2 if caption parse fails
    const form2 = new FormData();
    form2.append('chat_id', opts.chatId);
    form2.append('caption', opts.caption);
    form2.append(field, blob, opts.filename);
    tgRes = await fetch(`${opts.botApi}/${method}`, { method: 'POST', body: form2 });
    tgJson = await tgRes.json();
  }
  if (!tgJson.ok) {
    throw new Error(tgJson.description || 'Telegram media send failed');
  }

  const message = tgJson.result;
  if (opts.kind === 'photo' && Array.isArray(message.photo) && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    return {
      type: 'photo',
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id,
      fileSize: best.file_size,
    };
  }
  if (opts.kind === 'video' && message.video) {
    return {
      type: 'video',
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      mimeType: message.video.mime_type,
      fileName: message.video.file_name || opts.filename,
      fileSize: message.video.file_size,
    };
  }
  if (message.document) {
    return {
      type: 'document',
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name || opts.filename,
      fileSize: message.document.file_size,
    };
  }
  throw new Error('Telegram не вернул file_id');
}

export const crmChatRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: { fileSize: 48 * 1024 * 1024, files: 1 },
  });

  fastify.get(
    '/:recordId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId } = request.params as { recordId: string };
      if (!recordId || recordId.length < 10) {
        return reply.code(400).send({ error: 'Invalid CRM record id' });
      }

      const prisma = fastify.prisma;
      const subscriber = await findSubscriberForCrmRecord(prisma, tenantId, recordId);
      if (!subscriber) {
        return reply.code(404).send({
          error: 'No Telegram chat linked to this CRM record',
          messages: [],
        });
      }

      let conversationId = subscriber.conversationId;
      let mode = 'bot';
      if (conversationId) {
        const conversation = await prisma.conversation.findFirst({
          where: { id: conversationId, tenantId },
        });
        mode = conversation?.mode || 'bot';
      }

      const messages = conversationId
        ? await prisma.chatMessage.findMany({
            where: { conversationId },
            orderBy: { sentAt: 'asc' },
            take: 300,
          })
        : [];

      return reply.send({
        recordId,
        opportunityId: subscriber.twentyOpportunityId,
        personId: subscriber.twentyPersonId,
        subscriberId: subscriber.id,
        botId: subscriber.botInstanceId,
        telegramId: subscriber.telegramId,
        username: subscriber.username,
        firstName: subscriber.firstName,
        mode,
        formatHint: '**жирный**, __курсив__, ~~зачёркнутый~~, ||спойлер||, `код`',
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: Array.isArray(m.attachments)
            ? (m.attachments as unknown[]).map(mapAttachment).filter(Boolean)
            : [],
          sentAt: m.sentAt,
        })),
      });
    },
  );

  // Proxy Telegram file for CRM chat preview (auth + tenant-scoped)
  fastify.get(
    '/:recordId/file/:fileId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId, fileId } = request.params as {
        recordId: string;
        fileId: string;
      };
      if (!fileId || fileId.length < 10) {
        return reply.code(400).send({ error: 'Invalid file id' });
      }

      const prisma = fastify.prisma;
      const subscriber = await findSubscriberForCrmRecord(prisma, tenantId, recordId);
      if (!subscriber) return reply.code(404).send({ error: 'Not found' });

      const bot = await prisma.botInstance.findFirst({
        where: { id: subscriber.botInstanceId, tenantId, status: 'active' },
      });
      if (!bot?.botTokenEncrypted) return reply.code(404).send({ error: 'Bot not found' });

      const token = decrypt(bot.botTokenEncrypted);
      const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      });
      const meta = (await metaRes.json()) as {
        ok?: boolean;
        result?: { file_path?: string };
        description?: string;
      };
      if (!meta.ok || !meta.result?.file_path) {
        return reply.code(404).send({ error: meta.description || 'File not found' });
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) return reply.code(502).send({ error: 'Failed to fetch Telegram file' });

      const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await fileRes.arrayBuffer());
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'private, max-age=300')
        .send(buf);
    },
  );

  fastify.post(
    '/:recordId/reply',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canReply(user)) return reply.code(403).send({ error: 'Forbidden' });

      const { recordId } = request.params as { recordId: string };

      let text = '';
      let fileBuffer: Buffer | null = null;
      let filename = 'upload.bin';
      let mimeType = 'application/octet-stream';

      const contentType = String(request.headers['content-type'] || '');
      if (contentType.includes('multipart/form-data')) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer();
            filename = part.filename || filename;
            mimeType = part.mimetype || mimeType;
          } else if (part.type === 'field' && part.fieldname === 'text') {
            text = String(part.value || '');
          }
        }
      } else {
        const body = z
          .object({ text: z.string().max(4000).optional() })
          .safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
        text = (body.data.text || '').trim();
      }

      text = text.trim();
      if (!text && !fileBuffer?.length) {
        return reply.code(400).send({ error: 'Нужен текст или файл' });
      }
      if (text.length > 4000) {
        return reply.code(400).send({ error: 'Текст слишком длинный' });
      }

      const prisma = fastify.prisma;
      const subscriber = await findSubscriberForCrmRecord(prisma, tenantId, recordId);
      if (!subscriber) {
        return reply.code(404).send({ error: 'No Telegram chat linked to this CRM record' });
      }

      const bot = await prisma.botInstance.findFirst({
        where: { id: subscriber.botInstanceId, tenantId, status: 'active' },
      });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or inactive' });
      }

      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const chatId = subscriber.telegramId;

      let attachments: ChatAttachment[] = [];
      try {
        if (fileBuffer?.length) {
          const kind = detectUploadKind(mimeType, filename);
          const sent = await sendTelegramMedia({
            botApi,
            chatId,
            kind,
            buffer: fileBuffer,
            filename,
            mimeType,
            caption: text || undefined,
          });
          attachments = [sent];
          if (!text) {
            text =
              kind === 'photo'
                ? '[фото]'
                : kind === 'video'
                  ? '[видео]'
                  : `[файл: ${filename}]`;
          }
        } else {
          await sendTelegramText(botApi, chatId, text);
        }
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Telegram send failed' });
      }

      let conversationId = subscriber.conversationId;
      if (!conversationId) {
        const conversation = await prisma.conversation.create({
          data: {
            tenantId,
            botInstanceId: bot.id,
            platform: 'telegram',
            platformUserId: subscriber.telegramId,
            platformUsername: subscriber.username,
            platformFirstName: subscriber.firstName,
            status: 'open',
            mode: 'human',
          },
        });
        conversationId = conversation.id;
        await prisma.giftSubscriber.update({
          where: { id: subscriber.id },
          data: { conversationId },
        });
      }

      const message = await prisma.chatMessage.create({
        data: {
          conversationId,
          role: 'operator',
          content: text,
          attachments: attachments.length ? attachments : undefined,
        },
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { mode: 'human', updatedAt: new Date() },
      });
      await prisma.giftSubscriber.update({
        where: { id: subscriber.id },
        data: { lastMessageAt: new Date() },
      });

      if (subscriber.twentyPersonId) {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          const owner = await prisma.tenantMember.findFirst({
            where: { tenantId, role: 'owner' },
            include: { user: true },
          });
          if (
            tenant?.twentyWorkspaceId &&
            tenant.twentyOwnerPasswordEncrypted &&
            owner?.user?.email
          ) {
            const client = new TwentyClient({
              apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
            });
            await client.authenticateWorkspace(
              owner.user.email,
              decrypt(tenant.twentyOwnerPasswordEncrypted),
              tenant.twentyWorkspaceId,
            );
            await client.createNoteForPerson({
              personId: subscriber.twentyPersonId,
              title: 'Ответ оператора (Telegram)',
              body: text,
            });
          }
        } catch (err) {
          request.log.warn({ err }, 'Failed to mirror CRM reply note');
        }
      }

      return reply.send({
        ok: true,
        message: {
          id: message.id,
          role: message.role,
          content: message.content,
          attachments,
          sentAt: message.sentAt,
        },
      });
    },
  );
};
