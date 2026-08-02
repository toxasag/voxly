import './env.js';
import { prisma } from '@voxly/db';

let cached: boolean | null = null;

/** True when DATABASE_URL points at a reachable Postgres (local docker or CI service). */
export async function isTestDbReady(): Promise<boolean> {
  if (cached != null) return cached;
  try {
    await prisma.$queryRaw`SELECT 1`;
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}
