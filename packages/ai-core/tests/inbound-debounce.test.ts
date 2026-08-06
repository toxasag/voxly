import { describe, expect, it } from 'vitest';
import {
  filterHistoryAfterAgentUpdate,
  filterMediaCapabilityRefusals,
  isMediaCapabilityRefusal,
  hasEnrichedMediaTag,
  isNearDuplicateReply,
} from '../src/inbound-debounce';

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

  it('drops all messages before agent update (user and assistant)', () => {
    const msgs = [
      { role: 'user', createdAt: t0, content: 'hi' },
      { role: 'assistant', createdAt: t0, content: 'old persona' },
      { role: 'user', createdAt: t1, content: 'again' },
      { role: 'assistant', createdAt: t2, content: 'new persona' },
    ];
    expect(filterHistoryAfterAgentUpdate(msgs, t1)).toEqual([
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

describe('filterMediaCapabilityRefusals', () => {
  it('drops assistant media-capability refusals', () => {
    const msgs = [
      { role: 'user', content: '[видео]: это видео про заявку' },
      {
        role: 'assistant',
        content: 'Я получил видео, но не могу его просмотреть.\n\nМогу работать только с текстом и изображениями.',
      },
      { role: 'user', content: '[кружочек]: один' },
      { role: 'assistant', content: 'Отлично, один — принято.' },
    ];
    expect(filterMediaCapabilityRefusals(msgs)).toEqual([
      { role: 'user', content: '[видео]: это видео про заявку' },
      { role: 'user', content: '[кружочек]: один' },
      { role: 'assistant', content: 'Отлично, один — принято.' },
    ]);
  });

  it('detects voice listen refusals', () => {
    expect(
      isMediaCapabilityRefusal(
        'Я получил голосовое сообщение, но не могу его прослушать.',
      ),
    ).toBe(true);
    expect(
      isMediaCapabilityRefusal(
        'К сожалению, я не могу прослушать его содержание.\n\nПожалуйста, напишите ваш запрос текстом.',
      ),
    ).toBe(true);
    expect(
      isMediaCapabilityRefusal(
        'Я могу отвечать только на текстовые сообщения.',
      ),
    ).toBe(true);
  });
});

describe('hasEnrichedMediaTag / isNearDuplicateReply', () => {
  it('detects ASR/vision tags with body', () => {
    expect(hasEnrichedMediaTag('[голос]: Голосовое.')).toBe(true);
    expect(hasEnrichedMediaTag('[фото]: десерт')).toBe(true);
    expect(hasEnrichedMediaTag('[голосовое]')).toBe(false);
    expect(hasEnrichedMediaTag('[видео]')).toBe(false);
  });

  it('detects near-duplicate assistant replies', () => {
    const a =
      'Я понял, это видео про заявку.\n\nМогу ли я чем-то помочь по вашей заявке?\n\nРасскажите подробнее.';
    const b =
      'Я понял, это видео про заявку.\n\nМогу ли я чем-то помочь по вашей заявке?\n\nРасскажите подробнее, что именно вас интересует.';
    expect(isNearDuplicateReply(a, b)).toBe(true);
    expect(isNearDuplicateReply(a, 'Совсем другой ответ про фото десерта.')).toBe(false);
  });
});
