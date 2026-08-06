import { NextRequest, NextResponse } from 'next/server';

/** Public site origin — never use Docker-internal request.url (localhost:3000). */
function publicOrigin(): string {
  const domain = process.env.VOXLY_DOMAIN || 'getvoxly.ru';
  return `https://${domain}`;
}

/**
 * Legacy short links: https://getvoxly.ru/r/{CODE}
 * → landing with ?ref= (click counted once on landing).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await context.params;
  const code = raw.trim();
  const origin = publicOrigin();

  if (!code) {
    return NextResponse.redirect(`${origin}/`, 302);
  }

  const dest = new URL('/', origin);
  dest.searchParams.set('ref', code);
  return NextResponse.redirect(dest, 302);
}
