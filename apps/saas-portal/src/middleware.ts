// Multi-tenant middleware: detect {slug}.getvoxly.ru vs getvoxly.ru
import { NextRequest, NextResponse } from 'next/server';

const ROOT_DOMAIN = process.env.VOXLY_DOMAIN || 'getvoxly.ru';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0]; // strip port

  // Subdomain pattern: {slug}.getvoxly.ru
  const subdomainMatch = hostname.match(/^([a-z0-9-]+)\.${ROOT_DOMAIN.replace('.', '\\.')}$/i);

  if (subdomainMatch && subdomainMatch[1] !== 'www') {
    const slug = subdomainMatch[1];

    // Rewrite to tenant portal with slug header
    const response = NextResponse.rewrite(new URL(`/tenant/${slug}`, request.url));
    response.headers.set('x-tenant-slug', slug);
    return response;
  }

  // Root domain — landing or super-admin
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
