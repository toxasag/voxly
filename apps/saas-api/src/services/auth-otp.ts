import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Prisma, PrismaClient } from '@voxly/db';
import {
  generateOtpCode,
  platformBotDeepLink,
  platformBotUsername,
  sendPlatformTelegramMessage,
} from './platform-telegram.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function newAuthNonce(): string {
  return randomBytes(16).toString('hex');
}

export async function createRegisterChallenge(
  prisma: PrismaClient,
  pending: Record<string, unknown>,
) {
  const nonce = newAuthNonce();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.authOtpChallenge.create({
    data: {
      nonce,
      purpose: 'register',
      pendingPayload: pending as Prisma.InputJsonValue,
      expiresAt,
    },
  });
  return {
    nonce,
    expiresAt,
    botUsername: platformBotUsername(),
    botDeepLink: platformBotDeepLink(nonce),
  };
}

export async function createLoginChallenge(
  prisma: PrismaClient,
  userId: string,
  telegramUserId: bigint | null,
) {
  const nonce = newAuthNonce();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.authOtpChallenge.create({
    data: {
      nonce,
      purpose: telegramUserId ? 'login' : 'link',
      userId,
      telegramUserId: telegramUserId ?? undefined,
      expiresAt,
    },
  });

  // If already linked, send code immediately (bind will also send if they re-open deep link).
  if (telegramUserId) {
    const sub = await prisma.platformBotSubscriber.findUnique({
      where: { telegramUserId },
    });
    if (sub && !sub.blocked) {
      const code = generateOtpCode();
      await prisma.authOtpChallenge.update({
        where: { nonce },
        data: { codeHash: hashOtpCode(code), chatId: sub.chatId },
      });
      await sendPlatformTelegramMessage(
        sub.chatId,
        `Код входа в Voxly: ${code}\nДействует 10 минут.`,
      );
    }
  }

  return {
    nonce,
    expiresAt,
    needsTelegramLink: !telegramUserId,
    botUsername: platformBotUsername(),
    botDeepLink: platformBotDeepLink(nonce),
    codeSent: Boolean(telegramUserId),
  };
}

export async function bindAuthNonce(opts: {
  prisma: PrismaClient;
  nonce: string;
  telegramUserId: bigint;
  chatId: bigint;
  username?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { prisma, nonce, telegramUserId, chatId, username } = opts;
  const challenge = await prisma.authOtpChallenge.findUnique({ where: { nonce } });
  if (!challenge || challenge.consumedAt) {
    return { ok: false, error: 'Сессия не найдена или уже использована' };
  }
  if (challenge.expiresAt < new Date()) {
    return { ok: false, error: 'Сессия истекла — начните вход заново' };
  }

  await prisma.platformBotSubscriber.upsert({
    where: { telegramUserId },
    create: {
      telegramUserId,
      chatId,
      username: username || undefined,
    },
    update: {
      chatId,
      username: username || undefined,
      blocked: false,
      updatedAt: new Date(),
    },
  });

  const code = generateOtpCode();
  await prisma.authOtpChallenge.update({
    where: { id: challenge.id },
    data: {
      telegramUserId,
      chatId,
      codeHash: hashOtpCode(code),
    },
  });

  const purposeLabel =
    challenge.purpose === 'register'
      ? 'регистрации'
      : challenge.purpose === 'link'
        ? 'привязки Telegram'
        : 'входа';
  await sendPlatformTelegramMessage(
    chatId,
    `Код для ${purposeLabel} в Voxly: ${code}\nДействует 10 минут.\n\nНе сообщайте код никому.`,
  );
  return { ok: true };
}

export async function verifyOtpChallenge(opts: {
  prisma: PrismaClient;
  nonce: string;
  code: string;
  expectedPurposes: string[];
}) {
  const { prisma, nonce, code, expectedPurposes } = opts;
  const challenge = await prisma.authOtpChallenge.findUnique({ where: { nonce } });
  if (!challenge || !expectedPurposes.includes(challenge.purpose)) {
    return { ok: false as const, error: 'Неверная сессия подтверждения', status: 400 };
  }
  if (challenge.consumedAt) {
    return { ok: false as const, error: 'Код уже использован', status: 400 };
  }
  if (challenge.expiresAt < new Date()) {
    return { ok: false as const, error: 'Код истёк — начните заново', status: 400 };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false as const, error: 'Слишком много попыток', status: 429 };
  }
  if (!challenge.codeHash || !challenge.telegramUserId) {
    await prisma.authOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return {
      ok: false as const,
      error: 'Сначала откройте бота по ссылке и получите код',
      status: 400,
    };
  }
  const ok = challenge.codeHash === hashOtpCode(code.trim());
  if (!ok) {
    // Legacy: also accept bcrypt hashes if we ever switch
    const bcryptOk = challenge.codeHash.startsWith('$2')
      ? await bcrypt.compare(code.trim(), challenge.codeHash)
      : false;
    if (!bcryptOk) {
      await prisma.authOtpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false as const, error: 'Неверный код', status: 401 };
    }
  }

  await prisma.authOtpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true as const, challenge };
}

export async function linkTelegramToUser(
  prisma: PrismaClient,
  userId: string,
  telegramUserId: bigint,
  chatId: bigint,
  username?: string | null,
) {
  await prisma.user.updateMany({
    where: { telegramUserId, NOT: { id: userId } },
    data: { telegramUserId: null, telegramLinkedAt: null },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { telegramUserId, telegramLinkedAt: new Date() },
  });
  await prisma.platformBotSubscriber.upsert({
    where: { telegramUserId },
    create: {
      telegramUserId,
      chatId,
      userId,
      username: username || undefined,
    },
    update: {
      chatId,
      userId,
      username: username || undefined,
      blocked: false,
      updatedAt: new Date(),
    },
  });
}
