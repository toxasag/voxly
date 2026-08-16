import { describe, expect, it } from 'vitest';

import { OPPORTUNITY_KANBAN_CARD_FIELDS } from '@voxly/twenty-client';

describe('global Opportunity Kanban card defaults', () => {
  it('contains the schema-independent fields required for every new portal', () => {
    expect(OPPORTUNITY_KANBAN_CARD_FIELDS.map((field) => field.name)).toEqual([
      'name',
      'createdAt',
      'amount',
      'updatedAt',
      'createdBy',
      'closeDate',
      'company',
      'pointOfContact',
      'taskTargets',
      'noteTargets',
    ]);
  });

  it('keeps the activity timestamp after amount and before creator metadata', () => {
    const updatedAt = OPPORTUNITY_KANBAN_CARD_FIELDS.find(
      (field) => field.name === 'updatedAt',
    );
    expect(updatedAt).toEqual({ name: 'updatedAt', position: 1.5, size: 100 });
  });

  it('uses metadata names rather than workspace-specific UUIDs', () => {
    expect(
      OPPORTUNITY_KANBAN_CARD_FIELDS.every(
        (field) => /^[A-Za-z][A-Za-z0-9]*$/.test(field.name),
      ),
    ).toBe(true);
  });
});
