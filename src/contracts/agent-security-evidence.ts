import { z } from 'zod';
import { ActionTier } from './action-tier.js';
import { RiskLevel } from './risk.js';
import { newExecutionId } from './identifiers.js';

/**
 * Agent Security Evidence Contract (TechOps Monday Brief 2026-11-09).
 *
 * Spec: aion-docs/architecture/agent-security-evidence-contract.md
 *
 * Consequential executions must be able to prove:
 *   agent_id → principal → tenant → policy → requested_action
 *     → authorization → execution_trace → result → verification
 */

export const AGENT_SECURITY_EVIDENCE_ENVIRONMENTS = [
  'dev',
  'staging',
  'prod',
  'ci',
] as const;
export const AgentSecurityEvidenceEnvironment = z.enum(
  AGENT_SECURITY_EVIDENCE_ENVIRONMENTS,
);
export type AgentSecurityEvidenceEnvironment = z.infer<
  typeof AgentSecurityEvidenceEnvironment
>;

export const AUTHORIZATION_DECISIONS = ['allow', 'deny', 'gated'] as const;
export const AuthorizationDecision = z.enum(AUTHORIZATION_DECISIONS);
export type AuthorizationDecision = z.infer<typeof AuthorizationDecision>;

export const VERIFICATION_STATUSES = ['pass', 'fail', 'unknown'] as const;
export const VerificationStatus = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const ASE_PREDEPLOYMENT_TEST_IDS = [
  'ASE-PI-01',
  'ASE-TU-01',
  'ASE-TI-01',
  'ASE-IA-01',
  'ASE-RV-01',
  'ASE-EV-01',
] as const;
export const AsePredeploymentTestId = z.enum(ASE_PREDEPLOYMENT_TEST_IDS);
export type AsePredeploymentTestId = z.infer<typeof AsePredeploymentTestId>;

export const RequestedActionEvidence = z.object({
  capability: z.string().min(1),
  toolId: z.string().min(1).optional(),
  summary: z.string().min(1),
  payloadHash: z.string().min(1).optional(),
});
export type RequestedActionEvidence = z.infer<typeof RequestedActionEvidence>;

export const AuthorizationEvidence = z.object({
  decision: AuthorizationDecision,
  approvalId: z.string().min(1).optional(),
  riskLevel: RiskLevel,
  actionTier: ActionTier,
});
export type AuthorizationEvidence = z.infer<typeof AuthorizationEvidence>;

export const ResultEvidence = z.object({
  status: z.string().min(1),
  outcomeId: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
});
export type ResultEvidence = z.infer<typeof ResultEvidence>;

export const VerificationEvidence = z.object({
  method: z.string().min(1),
  status: VerificationStatus,
  checkedAt: z.string().datetime(),
  details: z.record(z.unknown()).optional(),
});
export type VerificationEvidence = z.infer<typeof VerificationEvidence>;

export const AgentSecurityEvidence = z.object({
  evidenceId: z.string().min(1),
  recordedAt: z.string().datetime(),
  agentId: z.string().min(1),
  principalId: z.string().min(1),
  tenantId: z.string().min(1),
  policyVersion: z.string().min(1),
  policyDecisionId: z.string().min(1).optional(),
  requestedAction: RequestedActionEvidence,
  authorization: AuthorizationEvidence,
  executionId: z.string().min(1).optional(),
  executionTraceRef: z.string().min(1).optional(),
  result: ResultEvidence,
  verification: VerificationEvidence.optional(),
  environment: AgentSecurityEvidenceEnvironment,
  residualRisks: z.array(z.string()).default([]),
});
export type AgentSecurityEvidence = z.infer<typeof AgentSecurityEvidence>;

/** Consequential packs require verification + execution refs when attempted. */
export function isCompleteConsequentialEvidence(
  evidence: AgentSecurityEvidence,
): boolean {
  if (!evidence.verification) return false;
  if (evidence.authorization.decision === 'deny') {
    return evidence.result.status === 'denied';
  }
  if (!evidence.executionId || !evidence.executionTraceRef) return false;
  return evidence.verification.status !== 'unknown';
}

export function createDeniedAgentSecurityEvidence(input: {
  agentId: string;
  principalId: string;
  tenantId: string;
  policyVersion: string;
  requestedAction: RequestedActionEvidence;
  riskLevel: z.infer<typeof RiskLevel>;
  actionTier: z.infer<typeof ActionTier>;
  environment: AgentSecurityEvidenceEnvironment;
  recordedAt?: string;
  reason?: string;
}): AgentSecurityEvidence {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  return AgentSecurityEvidence.parse({
    evidenceId: `ase_${newExecutionId().replace(/^exe_/, '')}`,
    recordedAt,
    agentId: input.agentId,
    principalId: input.principalId,
    tenantId: input.tenantId,
    policyVersion: input.policyVersion,
    requestedAction: input.requestedAction,
    authorization: {
      decision: 'deny',
      riskLevel: input.riskLevel,
      actionTier: input.actionTier,
    },
    result: {
      status: 'denied',
      errorCode: input.reason ?? 'policy_deny',
    },
    verification: {
      method: 'policy_deny_held',
      status: 'pass',
      checkedAt: recordedAt,
    },
    environment: input.environment,
    residualRisks: [],
  });
}
