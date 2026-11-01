import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ENTITY_KINDS,
  CANONICAL_ENTITY_SCHEMAS,
  CANONICAL_SCHEMA_VERSION,
  UnknownSchemaVersionError,
  parseCanonicalEntity,
  type CanonicalEntityKind,
} from '../../src/index.js';

const ts = '2026-11-01T19:00:00.000Z';
const base = { schemaVersion: '1', tenantId: 'tnt_acme', createdAt: ts, updatedAt: ts, metadata: {} };

const samples: Record<CanonicalEntityKind, Record<string, unknown>> = {
  Agent: { kind: 'Agent', id: 'agt_1', name: 'Follow-Up', ownerId: 'human_operator' },
  Workforce: { kind: 'Workforce', id: 'wfc_1', name: 'Revenue', agentIds: ['agt_1'] },
  Task: { kind: 'Task', id: 'tsk_1', title: 'Draft follow-up', status: 'open' },
  Workflow: { kind: 'Workflow', id: 'wf_1', name: 'Lead to audit', definitionVersion: '1.0.0' },
  Event: { kind: 'Event', id: 'evt_1', eventType: 'outreach.logged', occurredAt: ts, payload: {} },
  Policy: { kind: 'Policy', id: 'pol_1', name: 'No agent send', policyVersion: '1' },
  Memory: { kind: 'Memory', id: 'mem_1', subjectRef: 'cus_1', content: 'Prefers email' },
  LearningSignal: { kind: 'LearningSignal', id: 'lsg_1', signal: 'reply_rate_up' },
  Outcome: { kind: 'Outcome', id: 'out_1', status: 'realized' },
  Customer: { kind: 'Customer', id: 'cus_1', name: 'Acme' },
  Opportunity: { kind: 'Opportunity', id: 'opp_1', customerId: 'cus_1', stage: 'PROPOSAL_SENT' },
  EconomicValue: { kind: 'EconomicValue', id: 'ecv_1', amountMinor: 25000, currency: 'USD' },
};

describe('canonical entities (AIO-10)', () => {
  it('covers all 12 entities', () => {
    expect(CANONICAL_ENTITY_KINDS.sort()).toEqual(Object.keys(samples).sort());
    expect(CANONICAL_SCHEMA_VERSION).toBe('1');
  });

  for (const kind of Object.keys(samples) as CanonicalEntityKind[]) {
    describe(kind, () => {
      const valid = { ...base, ...samples[kind] };

      it('round-trips through JSON unchanged', () => {
        const parsed = parseCanonicalEntity(valid);
        const again = parseCanonicalEntity(JSON.parse(JSON.stringify(parsed)));
        expect(again).toEqual(parsed);
        expect(CANONICAL_ENTITY_SCHEMAS[kind].parse(valid)).toEqual(parsed);
      });

      it('rejects unknown and missing schemaVersion', () => {
        expect(() => parseCanonicalEntity({ ...valid, schemaVersion: '2' })).toThrow(UnknownSchemaVersionError);
        const { schemaVersion: _sv, ...noVersion } = valid;
        expect(() => parseCanonicalEntity(noVersion)).toThrow(UnknownSchemaVersionError);
        expect(CANONICAL_ENTITY_SCHEMAS[kind].safeParse({ ...valid, schemaVersion: '2' }).success).toBe(false);
      });

      it('requires a prefixed tenantId', () => {
        const { tenantId: _t, ...noTenant } = valid;
        expect(() => parseCanonicalEntity(noTenant)).toThrow();
        expect(() => parseCanonicalEntity({ ...valid, tenantId: 'acme' })).toThrow();
      });

      it('requires its own fields', () => {
        for (const field of Object.keys(samples[kind]).filter((f) => f !== 'kind')) {
          const schema = CANONICAL_ENTITY_SCHEMAS[kind];
          const shape = schema.shape as Record<string, { isOptional(): boolean }>;
          if (!shape[field] || shape[field].isOptional()) continue;
          const copy: Record<string, unknown> = { ...valid };
          delete copy[field];
          expect(schema.safeParse(copy).success, `${kind}.${field}`).toBe(false);
        }
      });
    });
  }

  it('rejects wrong-prefix ids and unknown kinds', () => {
    expect(() => parseCanonicalEntity({ ...base, ...samples.Customer, id: 'opp_1' })).toThrow();
    expect(() => parseCanonicalEntity({ ...base, kind: 'Invoice', id: 'x' })).toThrow();
  });
});
