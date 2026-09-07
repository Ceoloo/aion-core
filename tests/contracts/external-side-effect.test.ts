import { describe, it, expect } from 'vitest';
import {
  buildExternalIdempotencyKey,
  buildMission009Catalog,
  createExternalSideEffect,
  hashExternalResult,
  MISSION_009_SERVICE_KEYS,
} from '../../src/index.js';

describe('Mission 009 external side-effect + CRM catalog', () => {
  it('builds deterministic idempotency keys', () => {
    const a = buildExternalIdempotencyKey({
      executionId: 'exe_1',
      tenantId: 'aion-systems',
      serviceKey: 'crm.contact.update@1',
      requestedAction: 'contact.update',
      targetKey: 'contact:c_1',
    });
    const b = buildExternalIdempotencyKey({
      executionId: 'exe_1',
      tenantId: 'aion-systems',
      serviceKey: 'crm.contact.update@1',
      requestedAction: 'contact.update',
      targetKey: 'contact:c_1',
    });
    const c = buildExternalIdempotencyKey({
      executionId: 'exe_2',
      tenantId: 'aion-systems',
      serviceKey: 'crm.contact.update@1',
      requestedAction: 'contact.update',
      targetKey: 'contact:c_1',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('ik_')).toBe(true);
  });

  it('hashes results stably regardless of key order', () => {
    expect(hashExternalResult({ a: 1, b: 2 })).toBe(hashExternalResult({ b: 2, a: 1 }));
  });

  it('creates a parseable ExternalSideEffect', () => {
    const effect = createExternalSideEffect({
      executionId: 'exe_abc',
      tenantId: 'aion-systems',
      serviceKey: 'crm.note.create@1',
      idempotencyKey: 'ik_test',
      requestedAction: 'note.create',
      performedAt: '2026-09-07T00:00:00.000Z',
      status: 'succeeded',
      externalResourceId: 'note_1',
      resultHash: hashExternalResult({ ok: true }),
    });
    expect(effect.sideEffectId.startsWith('ese_')).toBe(true);
    expect(effect.provider).toBe('ghl');
    expect(effect.status).toBe('succeeded');
  });

  it('seeds Mission 009 CRM services with correct risk classes', () => {
    const catalog = buildMission009Catalog();
    expect(catalog.map((s) => s.serviceKey).sort()).toEqual(
      [...MISSION_009_SERVICE_KEYS].sort(),
    );
    const byName = Object.fromEntries(catalog.map((s) => [s.name, s]));
    expect(byName['crm.contact.read']?.riskLevel).toBe('R1');
    expect(byName['crm.contact.update']?.riskLevel).toBe('R2');
    expect(byName['crm.contact.update']?.approvalRequired).toBe(true);
    expect(byName['crm.message.send']?.riskLevel).toBe('R3');
    expect(byName['crm.message.send']?.approvalRequired).toBe(true);
  });
});
