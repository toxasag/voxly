import { describe, expect, it } from 'vitest';
import { filterHistoryAfterAgentUpdate } from '../src/inbound-debounce';

describe('filterHistoryAfterAgentUpdate', () => {
  const t0 = new Date('2026-07-26T10:00:00.000Z');
  const t1 = new Date('2026-07-26T11:00:00.000Z');
  const t2 = new Date('2026-07-26T12:00:00.000Z');

  it('keeps all messages when agentUpdatedAt is missing', () => {
    const msgs = [
      { role: 'user', createdAt: t0, content: 'a' },
      { role: 'assistant', createdAt: t1, content: 'b' },
    ];
    expect(filterHistoryAfterAgentUpdate(msgs, null)).toEqual(msgs);
    expect(filterHistoryAfterAgentUpdate(msgs, undefined)).toEqual(msgs);
  });

  it('drops assistant messages before agent update; keeps user turns', () => {
    const msgs = [
      { role: 'user', createdAt: t0, content: 'hi' },
      { role: 'assistant', createdAt: t0, content: 'old persona' },
      { role: 'user', createdAt: t1, content: 'again' },
      { role: 'assistant', createdAt: t2, content: 'new persona' },
    ];
    expect(filterHistoryAfterAgentUpdate(msgs, t1)).toEqual([
      { role: 'user', createdAt: t0, content: 'hi' },
      { role: 'user', createdAt: t1, content: 'again' },
      { role: 'assistant', createdAt: t2, content: 'new persona' },
    ]);
  });

  it('accepts ISO string timestamps', () => {
    const msgs = [
      { role: 'assistant', createdAt: '2026-07-26T10:00:00.000Z', content: 'old' },
      { role: 'assistant', createdAt: '2026-07-26T12:00:00.000Z', content: 'new' },
    ];
    expect(filterHistoryAfterAgentUpdate(msgs, '2026-07-26T11:00:00.000Z')).toEqual([
      { role: 'assistant', createdAt: '2026-07-26T12:00:00.000Z', content: 'new' },
    ]);
  });
});
