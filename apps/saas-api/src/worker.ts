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

async function main() {
  console.log('[saas-worker] Starting background workers and schedulers...');

  // Start background schedulers (grace period, expiry notify, broadcasts, etc.)
  startScheduledJobs();

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
