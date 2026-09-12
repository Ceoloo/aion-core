import { describe, it, expect } from 'vitest';
import {
  ACTOR_TYPES,
  APPROVAL_STATUSES,
  AUTONOMY_ENVIRONMENTS,
  AUTONOMY_GRANT_STATUSES,
  AUTONOMY_LEVELS,
  EXECUTION_OBJECT_STATUSES,
  EXTERNAL_SIDE_EFFECT_STATUSES,
  MISSION_STATUSES,
  OPERATION_STATUSES,
  OUTCOME_STATUSES,
  RISK_LEVELS,
  RUN_STATES,
  SERVICE_STATUSES,
} from '../../src/index.js';

/**
 * Canonical enum inventory — consumers (aion-data CHECKs, Runtime validators,
 * product clients) must mirror these sets. Changing a value here is a breaking
 * contract change and requires a coordinated migration.
 */
describe('canonical enum inventory', () => {
  it('keeps control-plane status domains stable', () => {
    expect([...MISSION_STATUSES]).toEqual([
      'draft',
      'active',
      'paused',
      'completed',
      'cancelled',
    ]);
    expect([...RUN_STATES]).toEqual([
      'created',
      'evaluating',
      'awaiting_approval',
      'approved',
      'executing',
      'completed',
      'failed',
      'denied',
      'cancelled',
    ]);
    expect([...APPROVAL_STATUSES]).toEqual(['pending', 'granted', 'rejected']);
    expect([...OUTCOME_STATUSES]).toEqual([
      'pending',
      'realized',
      'failed',
      'unknown',
    ]);
    expect([...OPERATION_STATUSES]).toEqual([
      'ok',
      'denied',
      'pending',
      'failed',
    ]);
    expect([...EXECUTION_OBJECT_STATUSES]).toEqual([
      'created',
      'evaluating',
      'awaiting_approval',
      'approved',
      'executing',
      'succeeded',
      'failed',
      'denied',
      'cancelled',
    ]);
    expect([...SERVICE_STATUSES]).toEqual(['active', 'deprecated']);
    expect([...EXTERNAL_SIDE_EFFECT_STATUSES]).toEqual([
      'pending',
      'succeeded',
      'failed',
      'replayed',
    ]);
    expect([...AUTONOMY_GRANT_STATUSES]).toEqual([
      'active',
      'revoked',
      'expired',
      'superseded',
    ]);
    expect([...AUTONOMY_ENVIRONMENTS]).toEqual(['staging', 'production']);
    expect([...ACTOR_TYPES]).toEqual(['human', 'agent', 'service', 'system']);
    expect([...RISK_LEVELS]).toEqual(['R0', 'R1', 'R2', 'R3']);
    expect([...AUTONOMY_LEVELS]).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
  });
});
