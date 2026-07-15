import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export { prisma };
export default prisma;
export * from '@prisma/client';
