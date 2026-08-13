/**
 * Reset super-admin password (bcrypt, 12 rounds) or create the super-admin user.
 *
 * Usage:
 *   DATABASE_URL=... SUPERADMIN_EMAIL=admin@getvoxly.ru \
 *     pnpm exec tsx scripts/reset-superadmin.ts --password 'NewPass!123'
 *
 * If --password is omitted, a random password is generated and printed ONCE.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (process.env.SUPERADMIN_EMAIL || argValue('email') || '').trim();
  if (!email || !email.includes('@')) {
    console.error('ERROR: SUPERADMIN_EMAIL (env) or --email <email> is required');
    process.exit(1);
  }

  const fromArg = argValue('password');
  const password =
    fromArg || (process.env.SUPERADMIN_PASSWORD || '').trim() || undefined;
  const generated = !password;
  const finalPassword = password || randomBytes(12).toString('base64url').slice(0, 18);

  const passwordHash = await bcrypt.hash(finalPassword, 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: 'superadmin' },
    });
    console.log(`✓ Super-admin password updated: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'superadmin',
        firstName: 'Super',
        lastName: 'Admin',
      },
    });
    console.log(`✓ Super-admin created: ${email}`);
  }

  if (generated) {
    console.log(`\n  Password (printed once): ${finalPassword}`);
    console.log('  Change it after first login!');
  } else {
    console.log('\n  Password set from --password / SUPERADMIN_PASSWORD.');
  }
}

main()
  .catch((err) => {
    console.error('reset-superadmin failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
