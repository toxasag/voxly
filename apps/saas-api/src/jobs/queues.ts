// Voxly BullMQ Queue setup
// Manages async jobs: workspace provisioning, email sending, subscription reminders

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { readFile } from 'node:fs/promises';
import { prisma } from '@voxly/db';
import { TwentyClient, workspaceUrlToOrigin } from '@voxly/twenty-client';
import { decrypt } from '@voxly/crypto';
import { ensureTwentyCustomDomain } from '../services/twenty-custom-domain.js';
import { ensureOpportunityRuDefaults } from '../services/twenty-opportunity-ru-defaults.js';
import { clearTwentyOnboardingFlags } from '../services/twenty-clear-onboarding.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
/** Integration tests import the API without starting BullMQ workers. */
const WORKERS_ENABLED = process.env.VOXLY_DISABLE_WORKERS !== '1';

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: !WORKERS_ENABLED });

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
  ownerPasswordEncrypted: string;
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

async function runProvisioningJob(job: { data: ProvisioningJobData }) {
  const { tenantId, ownerEmail, ownerPasswordEncrypted, ownerFirstName, workspaceName, slug } = job.data;

  console.log(`[provisioning] Starting for tenant ${tenantId}`);

  // 1. Create workspace in Twenty CRM
  const voxlyDomain = process.env.VOXLY_DOMAIN?.trim() || 'getvoxly.ru';
  const customDomainHost = `${slug}-crm.${voxlyDomain}`;
  const workspace = await twentyClient.provisionWorkspace({
    workspaceName,
    ownerEmail,
    ownerPassword: decrypt(ownerPasswordEncrypted),
    ownerFirstName,
    subdomain: slug,
    // GraphQL path needs Cloudflare; SQL fallback below is the prod path (INC-031).
    customDomain: customDomainHost,
  });

  // GraphQL updateWorkspace(customDomain) fails without CLOUDFLARE_API_KEY —
  // set via Twenty Postgres so Host `{slug}-crm.{domain}` resolves the workspace.
  await ensureTwentyCustomDomain(workspace.workspaceId, customDomainHost);
  // Standard-object isLabelSyncedWithName + INDEX view name need SQL (GraphQL blocked).
  await ensureOpportunityRuDefaults(workspace.workspaceId);
  // Clear ONBOARDING_* early (GraphQL skip inside provisionWorkspace can race signup).
  try {
    await clearTwentyOnboardingFlags(workspace.workspaceId);
  } catch (error) {
    console.warn(
      `[provisioning] early clearTwentyOnboardingFlags failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // 2. Install voxly-crm-chat from private server registry (upload tarball if needed)
  const publicBase = process.env.TWENTY_SERVER_URL?.trim() || '';
  const isLocal =
    /localhost|127\.0\.0\.1|\.lvh\.me/i.test(publicBase) ||
    /^(localhost|lvh\.me)$/i.test(voxlyDomain);
  const workspaceOrigin = isLocal
    ? workspaceUrlToOrigin(workspace.workspaceUrl)
    : `https://${customDomainHost}`;
  // Logic functions run inside twenty-server → must use docker DNS, not browser URL.
  const voxlyApiUrl = (
    process.env.VOXLY_CHAT_API_URL?.trim() ||
    'http://saas-api:3002'
  ).replace(/\/+$/, '');
  try {
    const tarballPath = process.env.VOXLY_CRM_CHAT_TARBALL?.trim();
    const tarball = tarballPath
      ? new Uint8Array(await readFile(tarballPath))
      : undefined;
    // Drop stale private-registry row so upload can publish the baked tarball.
    if (tarballPath && tarball?.byteLength) {
      const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
      if (connectionString) {
        const { default: pg } = await import('pg');
        const pgClient = new pg.Client({ connectionString });
        await pgClient.connect();
        try {
          await pgClient.query(
            `DELETE FROM core."applicationRegistrationVariable"
             WHERE "applicationRegistrationId" IN (
               SELECT id FROM core."applicationRegistration"
               WHERE "universalIdentifier" = $1
             )`,
            ['b5c92442-f0ae-4090-8a31-88fd51785c25'],
          );
          await pgClient.query(
            `DELETE FROM core."applicationRegistration" WHERE "universalIdentifier" = $1`,
            ['b5c92442-f0ae-4090-8a31-88fd51785c25'],
          );
        } finally {
          await pgClient.end();
        }
      }
    }
    await twentyClient.ensureCrmChatAppInstalled({
      workspaceOrigin,
      voxlyApiUrl,
      tarball,
      tarballPath,
      // Always reinstall from baked tarball so new tenants get latest UI (AI buttons, etc.).
      forceReinstall: true,
    });
    console.log(
      `[provisioning] CRM chat installed for ${tenantId} (origin=${workspaceOrigin})`,
    );
  } catch (error) {
    // Do not fail the whole provision — workspace already exists; retrying the job
    // would risk creating a second Twenty workspace.
    console.error(
      `[provisioning] Workspace created, but chat app install failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Marketplace install can re-surface /install-apps; dismiss again after chat install.
  try {
    await twentyClient.skipInstallAppsOnboarding();
  } catch (error) {
    console.warn(
      `[provisioning] skipInstallAppsOnboarding failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // SQL clears all ONBOARDING_*_PENDING keys (install-apps / profile / sync / invite).
  // GraphQL skip alone races signup and only covers INSTALL_APPS.
  try {
    await clearTwentyOnboardingFlags(workspace.workspaceId);
  } catch (error) {
    console.warn(
      `[provisioning] clearTwentyOnboardingFlags failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

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
}

export const provisioningWorker = WORKERS_ENABLED
  ? new Worker<ProvisioningJobData>('provisioning', runProvisioningJob, {
      connection,
      concurrency: 3,
    })
  : null;

provisioningWorker?.on('failed', (job, err) => {
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
export const emailWorker = WORKERS_ENABLED
  ? new Worker<EmailJobData>(
      'email',
      async (job) => {
        const { to, subject, body } = job.data;
        // TODO: Integrate with SMTP (nodemailer)
        console.log(`[email] To: ${to}, Subject: ${subject}`);
        // Placeholder: in production use nodemailer.sendMail()
      },
      { connection, concurrency: 5 },
    )
  : null;

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

