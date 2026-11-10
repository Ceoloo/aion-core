import { describe, it, expect } from 'vitest';
import {
  ASE_PREDEPLOYMENT_TEST_IDS,
  AgentSecurityEvidence,
  createDeniedAgentSecurityEvidence,
  isCompleteConsequentialEvidence,
} from '../../src/index.js';

const NOW = '2026-11-09T15:00:00.000Z';

describe('AgentSecurityEvidence', () => {
  it('parses a full consequential evidence pack', () => {
    const pack = AgentSecurityEvidence.parse({
      evidenceId: 'ase_test_1',
      recordedAt: NOW,
      agentId: 'agent://aion/accounting/reconcile/prep-1',
      principalId: 'user:dana@aion.systems',
      tenantId: 'aion-internal',
      policyVersion: 'pol_2026_11_09',
      policyDecisionId: 'dec_1',
      requestedAction: {
        capability: 'ledger.prepare_adjustment',
        toolId: 'tool_ledger',
        summary: 'Prepare reconciliation adjustment draft',
        payloadHash: 'sha256:abc',
      },
      authorization: {
        decision: 'allow',
        riskLevel: 'R2',
        actionTier: 'assist',
      },
      executionId: 'exe_1',
      executionTraceRef: 'events:exe_1',
      result: { status: 'succeeded', outcomeId: 'out_1' },
      verification: {
        method: 'outcome_match',
        status: 'pass',
        checkedAt: NOW,
      },
      environment: 'staging',
      residualRisks: [],
    });

    expect(isCompleteConsequentialEvidence(pack)).toBe(true);
  });

  it('rejects incomplete consequential packs missing verification', () => {
    const pack = AgentSecurityEvidence.parse({
      evidenceId: 'ase_test_2',
      recordedAt: NOW,
      agentId: 'agent://aion/accounting/pay/1',
      principalId: 'user:dana@aion.systems',
      tenantId: 'aion-internal',
      policyVersion: 'pol_2026_11_09',
      requestedAction: {
        capability: 'payments.execute',
        summary: 'Execute vendor payment',
      },
      authorization: {
        decision: 'allow',
        approvalId: 'apr_1',
        riskLevel: 'R3',
        actionTier: 'execute',
      },
      executionId: 'exe_2',
      executionTraceRef: 'events:exe_2',
      result: { status: 'succeeded' },
      environment: 'ci',
    });

    expect(isCompleteConsequentialEvidence(pack)).toBe(false);
  });

  it('creates a denied pack that still verifies the deny held', () => {
    const denied = createDeniedAgentSecurityEvidence({
      agentId: 'agent://aion/dealer/finance/1',
      principalId: 'user:ops@aion.systems',
      tenantId: 'dealer-demo',
      policyVersion: 'pol_2026_11_09',
      requestedAction: {
        capability: 'financing.submit',
        summary: 'Submit financing application',
      },
      riskLevel: 'R3',
      actionTier: 'execute',
      environment: 'ci',
      recordedAt: NOW,
      reason: 'missing_human_approval',
    });

    expect(denied.authorization.decision).toBe('deny');
    expect(denied.result.status).toBe('denied');
    expect(isCompleteConsequentialEvidence(denied)).toBe(true);
  });

  it('exports stable ASE predeployment test ids', () => {
    expect(ASE_PREDEPLOYMENT_TEST_IDS).toEqual([
      'ASE-PI-01',
      'ASE-TU-01',
      'ASE-TI-01',
      'ASE-IA-01',
      'ASE-RV-01',
      'ASE-EV-01',
    ]);
  });
});
