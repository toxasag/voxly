import { describe, it, expect } from 'vitest';
import { chunkText, cosineSimilarity, formatRagPromptBlock, parseAgentLearnSettings } from '../src/rag';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('splits long text with overlap', () => {
    const text = 'a'.repeat(2500);
    const chunks = chunkText(text, 1000, 150);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.length).toBe(1000);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('parseAgentLearnSettings', () => {
  it('defaults to USPESHNAYA_SDELKA + CUSTOMER won stages and learning on', () => {
    expect(parseAgentLearnSettings(null)).toEqual({
      learnFromWonDeals: true,
      wonStages: ['USPESHNAYA_SDELKA', 'CUSTOMER'],
    });
  });

  it('respects overrides', () => {
    expect(
      parseAgentLearnSettings({ learnFromWonDeals: false, wonStages: ['WON'] }),
    ).toEqual({ learnFromWonDeals: false, wonStages: ['WON'] });
  });
});

describe('formatRagPromptBlock', () => {
  it('returns empty when no context', () => {
    expect(formatRagPromptBlock({ knowledge: [], sales: [] })).toBe('');
  });

  it('includes knowledge and sales', () => {
    const block = formatRagPromptBlock({
      knowledge: ['цена 100'],
      sales: [{ userText: 'сколько?', operatorText: '100 рублей' }],
    });
    expect(block).toContain('База знаний');
    expect(block).toContain('успешных продаж');
    expect(block).toContain('100 рублей');
  });
});
