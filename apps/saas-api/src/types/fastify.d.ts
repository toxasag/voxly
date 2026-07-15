import type { PrismaClient } from '@voxly/db';
import type { RobokassaClient } from '@voxly/billing';
import type { TwentyClient } from '@voxly/twenty-client';
import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    robokassa: RobokassaClient;
    twenty: TwentyClient;
    voxlyDomain: string;
    authenticate: (request: any, reply: any) => Promise<void>;
    requireSuperadmin: (request: any, reply: any) => Promise<void>;
  }
}
