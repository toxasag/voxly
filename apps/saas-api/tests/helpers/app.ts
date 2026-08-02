import './env.js';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/index.js';

let appPromise: Promise<FastifyInstance> | null = null;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildServer();
  }
  return appPromise;
}

export async function closeTestApp(): Promise<void> {
  if (appPromise) {
    const app = await appPromise;
    await app.close();
    appPromise = null;
  }
}

export async function authHeaderFor(
  app: FastifyInstance,
  user: { id: string; email: string; role?: string },
  membership: { role: string; tenantId: string },
): Promise<Record<string, string>> {
  const token = app.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role || 'owner',
    tenantRole: membership.role,
    tenantId: membership.tenantId,
  });
  return { authorization: `Bearer ${token}` };
}
