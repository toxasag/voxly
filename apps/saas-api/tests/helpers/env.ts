process.env.VOXLY_DISABLE_WORKERS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ROBOKASSA_LOGIN = process.env.ROBOKASSA_LOGIN || 'test-login';
process.env.ROBOKASSA_PASSWORD1 = process.env.ROBOKASSA_PASSWORD1 || 'pass1';
process.env.ROBOKASSA_PASSWORD2 = process.env.ROBOKASSA_PASSWORD2 || 'pass2';
process.env.ROBOKASSA_IS_TEST = '1';
process.env.VOXLY_DOMAIN = process.env.VOXLY_DOMAIN || 'getvoxly.ru';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://voxly:voxly_pass@127.0.0.1:5433/voxly_test?schema=public';
}
