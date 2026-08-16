import { describe, expect, it } from 'vitest';

import { buildTimelineSyncKey } from '../src/timeline-sync-queue.js';

describe('buildTimelineSyncKey', () => {
  it('keys message events per message, not per conversation', () => {
    const a = buildTimelineSyncKey({
      tenantId: 't1',
      kind: 'chat_outbound',
      conversationId: 'conv1',
      messageId: 'msg1',
    });
    const b = buildTimelineSyncKey({
      tenantId: 't1',
      kind: 'chat_outbound',
      conversationId: 'conv1',
      messageId: 'msg2',
    });
    expect(a).not.toBe(b);
    expect(a).toBe('t1.chat_outbound.msg.msg1');
  });

  it('keeps conversation-level dedup for thread/deal events (no messageId)', () => {
    const a = buildTimelineSyncKey({
      tenantId: 't1',
      kind: 'chat_thread_created',
      conversationId: 'conv1',
    });
    const b = buildTimelineSyncKey({
      tenantId: 't1',
      kind: 'chat_thread_created',
      conversationId: 'conv1',
    });
    expect(a).toBe(b);
    expect(a).toBe('t1.chat_thread_created.conv.conv1');
  });

  it('never produces a BullMQ-illegal ":" in the id', () => {
    const k = buildTimelineSyncKey({
      tenantId: 't1',
      kind: 'chat_outbound',
      conversationId: 'conv1',
      messageId: 'msg1',
    });
    expect(k.includes(':')).toBe(false);
  });

  it('falls back to a unique key when neither id is present', () => {
    const a = buildTimelineSyncKey({ tenantId: 't1', kind: 'chat_inbound' });
    const b = buildTimelineSyncKey({ tenantId: 't1', kind: 'chat_inbound' });
    expect(a).not.toBe(b);
  });
});
