import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const crmChat = readFileSync(new URL('../src/routes/crm-chat.ts', import.meta.url), 'utf8');
const maxRoutes = readFileSync(
  new URL('../src/routes/max-internal.ts', import.meta.url),
  'utf8',
);
const waWorker = readFileSync(
  new URL('../../ai-whatsapp-worker/src/index.ts', import.meta.url),
  'utf8',
);

describe('native outbound CRM contracts', () => {
  it('persists an outbound CrmRecordLink after CRM reply target resolution', () => {
    expect(crmChat).toContain("source: 'outbound'");
    expect(crmChat).toContain('finalConversation');
  });

  it('has an idempotent MAX outbound endpoint and native external id', () => {
    expect(maxRoutes).toContain("fastify.post('/outbound'");
    expect(maxRoutes).toContain('`max:${messageId}`');
    expect(maxRoutes).toContain("role: 'operator'");
    expect(maxRoutes).toContain('fromMe: true');
  });

  it('routes WhatsApp fromMe events to the mirror path, not inbound AI', () => {
    expect(waWorker).toContain('if (fromMe)');
    expect(waWorker).toContain('mirrorWaPhoneOutbound');
    expect(waWorker).toContain('allowOpportunityCreate: false');
  });
});
