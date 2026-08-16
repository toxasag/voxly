import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const twentyClient = readFileSync(
  new URL('../../../packages/twenty-client/src/index.ts', import.meta.url),
  'utf8',
);
const aiCore = readFileSync(
  new URL('../../../packages/ai-core/src/timeline-sync-queue.ts', import.meta.url),
  'utf8',
);
const queues = readFileSync(
  new URL('../src/jobs/queues.ts', import.meta.url),
  'utf8',
);
const maxInternal = readFileSync(
  new URL('../src/routes/max-internal.ts', import.meta.url),
  'utf8',
);

describe('chat events in Twenty Timeline', () => {
  it('twenty-client creates timeline activities linked to Person/Opportunity', () => {
    expect(twentyClient).toContain('createTimelineActivity(data: $data)');
    expect(twentyClient).toContain('createChatTimelineActivity');
    expect(twentyClient).toContain('targetPersonId');
    expect(twentyClient).toContain('targetOpportunityId');
  });

  it('timeline-sync worker has a best-effort external sink hook', () => {
    expect(aiCore).toContain('writeExternal?: (data: TimelineSyncJobData) => Promise<void>');
    expect(aiCore).toContain('opts.writeExternal(data)');
  });

  it('saas-api maps queue events to Twenty timeline + kanban updatedAt touch', () => {
    expect(queues).toContain('writeTimelineEventToTwenty');
    expect(queues).toContain('createChatTimelineActivity');
    expect(queues).toContain('touchOpportunityActivity(opportunityId)');
    // Conversation links resolve when the job lacks explicit CRM ids.
    expect(queues).toContain('twentyOpportunityId: true');
  });

  it('MAX live inbound and native outbound enqueue timeline events', () => {
    expect(maxInternal).toContain("kind: 'chat_inbound'");
    expect(maxInternal).toContain("kind: 'chat_outbound'");
    expect(maxInternal).toContain("channel: 'ai_max'");
  });
});
