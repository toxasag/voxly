// Voxly SaaS Worker — standalone entry point for BullMQ background workers
// Runs async queues (provisioning, email, subscriptions, form leads, CRM enrich, AI usage, timeline sync)
// and scheduled cron-like background jobs without handling HTTP traffic.

import { prisma } from '@voxly/db';
import { startScheduledJobs } from './jobs/scheduler.js';
import {
  provisioningWorker,
  emailWorker,
  formLeadWorker,
  gramjsCrmEnrichWorker,
  aiUsageWorker,
  timelineSyncWorker,
} from './jobs/queues.js';
import { refreshCrmChatAppsIfTarballChanged } from './services/crm-chat-app-auto-refresh.js';

async function main() {
  console.log('[saas-worker] Starting background workers and schedulers...');

  // Start background schedulers (grace period, expiry notify, broadcasts, etc.)
  startScheduledJobs();

  // Deploy hook: when the baked voxly-crm-chat tarball changed, force-reinstall
  // the app in every provisioned workspace so existing tenants get the new UI.
  void refreshCrmChatAppsIfTarballChanged().catch((err) => {
    console.error(
      '[crmchat-refresh] boot refresh failed:',
      err instanceof Error ? err.message : String(err),
    );
  });

  console.log('[saas-worker] Registered workers:', {
    provisioning: Boolean(provisioningWorker),
    email: Boolean(emailWorker),
    formLead: Boolean(formLeadWorker),
    gramjsCrmEnrich: Boolean(gramjsCrmEnrichWorker),
    aiUsage: Boolean(aiUsageWorker),
    timelineSync: Boolean(timelineSyncWorker),
  });

  console.log('[saas-worker] Running and listening for queue jobs.');
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('[saas-worker] Received SIGTERM, shutting down...');
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[saas-worker] Received SIGINT, shutting down...');
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
});

main().catch((err) => {
  console.error('[saas-worker] Fatal error during startup:', err);
  process.exit(1);
});
