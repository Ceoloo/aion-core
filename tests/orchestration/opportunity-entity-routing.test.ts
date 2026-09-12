import { describe, expect, it } from 'vitest';
import { capability } from '../../src/contracts/capability.js';
import {
  existingOpportunityId,
  resolveOpportunityCapability,
} from '../../src/orchestration/opportunity-entity-routing.js';

describe('opportunity entity-state routing', () => {
  const create = capability('crm.opportunity.create');
  const update = capability('crm.opportunity.update');
  const note = capability('crm.note.create');

  it('keeps create when no opportunity id is present', () => {
    expect(resolveOpportunityCapability(create, {})).toBe(create);
    expect(resolveOpportunityCapability(create, { contactId: 'c1' })).toBe(
      create,
    );
    expect(resolveOpportunityCapability(create, undefined)).toBe(create);
  });

  it('routes create → update when opportunityId is present', () => {
    expect(
      resolveOpportunityCapability(create, {
        opportunityId: 'rGbIyrAvGDcmMEzjBER4',
        contactId: 'MyWCgeFaKnifp6LM7yIc',
      }),
    ).toBe(update);
  });

  it('accepts ghlOpportunityId alias', () => {
    expect(
      resolveOpportunityCapability(create, {
        ghlOpportunityId: 'rGbIyrAvGDcmMEzjBER4',
      }),
    ).toBe(update);
  });

  it('does not rewrite non-create capabilities', () => {
    expect(
      resolveOpportunityCapability(update, {
        opportunityId: 'rGbIyrAvGDcmMEzjBER4',
      }),
    ).toBe(update);
    expect(
      resolveOpportunityCapability(note, {
        opportunityId: 'rGbIyrAvGDcmMEzjBER4',
      }),
    ).toBe(note);
  });

  it('extracts existing opportunity ids', () => {
    expect(existingOpportunityId({ opportunityId: '  abc  ' })).toBe('abc');
    expect(existingOpportunityId({ ghlOpportunityId: 'xyz' })).toBe('xyz');
    expect(existingOpportunityId({})).toBeUndefined();
  });
});
