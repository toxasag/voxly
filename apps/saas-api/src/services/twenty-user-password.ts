import bcrypt from 'bcryptjs';
import pg from 'pg';

/** Twenty uses bcrypt with 10 salt rounds (auth.util.ts). */
const TWENTY_SALT_ROUNDS = 10;

export async function updateTwentyUserPassword(
  email: string,
  plainPassword: string,
): Promise<boolean> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return false;

  const normalized = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(plainPassword, TWENTY_SALT_ROUNDS);

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE core."user"
       SET "passwordHash" = $1, "updatedAt" = NOW()
       WHERE lower(email) = $2 AND "deletedAt" IS NULL`,
      [passwordHash, normalized],
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}
