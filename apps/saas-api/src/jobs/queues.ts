// Voxly BullMQ Queue setup
// Manages async jobs: workspace provisioning, email sending, subscription reminders

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';
import { TwentyClient } from '@voxly/twenty-client';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

// =====================================
// Queues
// =====================================
export const provisioningQueue = new Queue('provisioning', { connection });
export const emailQueue = new Queue('email', { connection });
export const subscriptionQueue = new Queue('subscription', { connection });

// =====================================
// Job data types
// =====================================
export interface ProvisioningJobData {
  tenantId: string;
  ownerEmail: string;
  ownerFirstName?: string;
  workspaceName: string;
  slug: string;
}

export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}

// =====================================
// Worker: Provision Twenty workspace
// =====================================
const twentyClient = new TwentyClient({
  apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  apiKey: process.env.TWENTY_API_KEY,
});

export const provisioningWorker = new Worker<ProvisioningJobData>(
  'provisioning',
  async (job) => {
    const { tenantId, ownerEmail, ownerFirstName, workspaceName, slug } = job.data;

    console.log(`[provisioning] Starting for tenant ${tenantId}`);

    // 1. Create workspace in Twenty CRM
    const tempPassword = generateTempPassword();
    const workspace = await twentyClient.provisionWorkspace({
      workspaceName,
      ownerEmail,
      ownerPassword: tempPassword,
      ownerFirstName,
      subdomain: slug,
    });

    // 2. Install voxly-platform app
    await twentyClient.installApp('voxly-platform');

    // 3. Update tenant with workspace ID
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        twentyWorkspaceId: workspace.workspaceId,
        twentyWorkspaceSlug: slug,
        status: 'active',
      },
    });

    // 4. Queue welcome email
    await emailQueue.add('welcome', {
      to: ownerEmail,
      subject: 'Добро пожаловать в Voxly!',
      body: `Здравствуйте!\n\nВаш воркспейс "${workspaceName}" готов.\nДоступ к CRM: https://${slug}-crm.getvoxly.ru\n\n— Команда Voxly`,
    } as EmailJobData);

    console.log(`[provisioning] Completed for tenant ${tenantId}, workspace=${workspace.workspaceId}`);
    return { workspaceId: workspace.workspaceId };
  },
  { connection, concurrency: 3 },
);

provisioningWorker.on('failed', (job, err) => {
  console.error(`[provisioning] Job ${job?.id} failed:`, err.message);
  if (job?.data?.tenantId) {
    prisma.tenant.update({
      where: { id: job.data.tenantId },
      data: { status: 'provisioning_failed' },
    }).catch(console.error);
  }
});

// =====================================
// Worker: Send emails
// =====================================
export const emailWorker = new Worker<EmailJobData>(
  'email',
  async (job) => {
    const { to, subject, body, isHtml } = job.data;
    // TODO: Integrate with SMTP (nodemailer)
    console.log(`[email] To: ${to}, Subject: ${subject}`);
    // Placeholder: in production use nodemailer.sendMail()
  },
  { connection, concurrency: 5 },
);

// =====================================
// Helper: Enqueue provisioning
// =====================================
export async function enqueueProvisioning(data: ProvisioningJobData): Promise<void> {
  await provisioningQueue.add('provision-workspace', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

// =====================================
// Helper: Enqueue email
// =====================================
export async function enqueueEmail(data: EmailJobData): Promise<void> {
  await emailQueue.add('send', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

function generateTempPassword(): string {
  return Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6);
}
