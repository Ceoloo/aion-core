import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentActor } from './actor.js';
import { registryCompleteness, reviewAgentRegistry } from './agent-registry.js';
import type { ExecutionObject } from './execution.js';

/**
 * Continuous Assurance contracts (AIO-47 / SIS-CA-*).
 *
 * Spec: aion-docs/architecture/continuous-assurance-v1.md
 * Prototype connectors evaluate registry + execution evidence in Runtime;
 * other catalog checks remain connector stubs (`unknown` until wired).
 */

export const ASSURANCE_CADENCES = [
  'continuous',
  'hourly_daily',
  'daily',
  'weekly',
  'monthly',
] as const;
export const AssuranceCadence = z.enum(ASSURANCE_CADENCES);
export type AssuranceCadence = z.infer<typeof AssuranceCadence>;

export const ASSURANCE_SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;
export const AssuranceSeverity = z.enum(ASSURANCE_SEVERITIES);
export type AssuranceSeverity = z.infer<typeof AssuranceSeverity>;

export const ASSURANCE_STATUSES = [
  'pass',
  'fail',
  'unknown',
  'error',
] as const;
export const AssuranceStatus = z.enum(ASSURANCE_STATUSES);
export type AssuranceStatus = z.infer<typeof AssuranceStatus>;

/** Prototype-implemented check IDs (Runtime registry / gateway connectors). */
export const PROTOTYPE_ASSURANCE_CHECK_IDS = [
  'CA-AG-01',
  'CA-AG-02',
  'CA-AG-03',
  'CA-AG-04',
  'CA-RT-01',
  'CA-RV-02',
] as const;

/** Full catalog IDs from continuous-assurance-v1.md §2. */
export const ASSURANCE_CHECK_IDS = [
  'CA-EXP-01',
  'CA-EXP-02',
  'CA-ID-01',
  'CA-ID-02',
  'CA-ID-03',
  'CA-CT-01',
  'CA-CT-02',
  'CA-CT-03',
  'CA-CL-01',
  'CA-CL-02',
  'CA-CL-03',
  'CA-BK-01',
  'CA-BK-02',
  'CA-AG-01',
  'CA-AG-02',
  'CA-AG-03',
  'CA-AG-04',
  'CA-RT-01',
  'CA-RT-02',
  'CA-VN-01',
  'CA-VN-02',
  'CA-RV-01',
  'CA-RV-02',
] as const;
export const AssuranceCheckId = z.enum(ASSURANCE_CHECK_IDS);
export type AssuranceCheckId = z.infer<typeof AssuranceCheckId>;

export interface AssuranceCheckDefinition {
  checkId: AssuranceCheckId;
  domain: string;
  title: string;
  cadence: AssuranceCadence;
  failSeverity: AssuranceSeverity;
  /** True when Runtime has a connector for this check in the AIO-47 prototype. */
  prototype: boolean;
  sisControls: string[];
}

export const ASSURANCE_CHECK_CATALOG: readonly AssuranceCheckDefinition[] = [
  { checkId: 'CA-EXP-01', domain: 'external_exposure', title: 'Unexpected public asset / open admin surface', cadence: 'daily', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03'] },
  { checkId: 'CA-EXP-02', domain: 'external_exposure', title: 'DNS / TLS cert expiry ≤ 14 days', cadence: 'daily', failSeverity: 'medium', prototype: false, sisControls: ['SIS-CA-03'] },
  { checkId: 'CA-ID-01', domain: 'identity', title: 'Privileged accounts without phishing-resistant MFA', cadence: 'daily', failSeverity: 'critical', prototype: false, sisControls: ['SIS-CA-03', 'SIS-HI-01'] },
  { checkId: 'CA-ID-02', domain: 'identity', title: 'Stale / risky sessions vs revoke playbook', cadence: 'daily', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-HI-05'] },
  { checkId: 'CA-ID-03', domain: 'identity', title: 'New OAuth / app-consent grants outside allow-list', cadence: 'hourly_daily', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-HI-03'] },
  { checkId: 'CA-CT-01', domain: 'credentials', title: 'Credential & Token Inventory vs live grants drift', cadence: 'daily', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-CT-01'] },
  { checkId: 'CA-CT-02', domain: 'credentials', title: 'Long-lived LoB keys detected in agent/runtime scopes', cadence: 'daily', failSeverity: 'critical', prototype: false, sisControls: ['SIS-CA-03', 'SIS-CT-07', 'SIS-GX-07'] },
  { checkId: 'CA-CT-03', domain: 'credentials', title: 'Secrets in git / shared docs (negative scan)', cadence: 'daily', failSeverity: 'critical', prototype: false, sisControls: ['SIS-CA-03', 'SIS-AU-02'] },
  { checkId: 'CA-CL-01', domain: 'cloud_saas', title: 'Tenant hardening baseline drift', cadence: 'weekly', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-CL-01'] },
  { checkId: 'CA-CL-02', domain: 'cloud_saas', title: 'External sharing / admin role standing privilege drift', cadence: 'weekly', failSeverity: 'medium', prototype: false, sisControls: ['SIS-CA-03'] },
  { checkId: 'CA-CL-03', domain: 'cloud_saas', title: 'Audit log retention below 180 days', cadence: 'weekly', failSeverity: 'medium', prototype: false, sisControls: ['SIS-CA-03', 'SIS-CL-04'] },
  { checkId: 'CA-BK-01', domain: 'backup', title: 'Backup freshness beyond RPO', cadence: 'daily', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-BK-01'] },
  { checkId: 'CA-BK-02', domain: 'backup', title: 'Restore evidence older than 90 days', cadence: 'weekly', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-BK-03'] },
  { checkId: 'CA-AG-01', domain: 'agent_permission', title: 'Registry incomplete for Execute-tier agents', cadence: 'continuous', failSeverity: 'critical', prototype: true, sisControls: ['SIS-CA-03', 'SIS-AG-02'] },
  { checkId: 'CA-AG-02', domain: 'agent_permission', title: 'Observed agent not in registry (SIS-AG-10)', cadence: 'continuous', failSeverity: 'critical', prototype: true, sisControls: ['SIS-CA-03', 'SIS-AG-10'] },
  { checkId: 'CA-AG-03', domain: 'agent_permission', title: 'Tools / data_scope / policy_version drift vs registry', cadence: 'daily', failSeverity: 'high', prototype: true, sisControls: ['SIS-CA-03', 'SIS-AG-05', 'SIS-AG-08'] },
  { checkId: 'CA-AG-04', domain: 'agent_behavior', title: 'Trust Score / deny spikes for tenant', cadence: 'continuous', failSeverity: 'medium', prototype: true, sisControls: ['SIS-CA-03', 'SIS-AG-06'] },
  { checkId: 'CA-RT-01', domain: 'runtime', title: 'Gateway / Runtime health + FeatureGate kill path', cadence: 'continuous', failSeverity: 'high', prototype: true, sisControls: ['SIS-CA-03', 'SIS-GX-10'] },
  { checkId: 'CA-RT-02', domain: 'runtime', title: 'Endpoint protection coverage gap', cadence: 'daily', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-DV-01'] },
  { checkId: 'CA-VN-01', domain: 'vulnerabilities', title: 'Critical CVE on internet-facing or agent host', cadence: 'daily', failSeverity: 'critical', prototype: false, sisControls: ['SIS-CA-03'] },
  { checkId: 'CA-VN-02', domain: 'vulnerabilities', title: 'High CVE unpatched past SLA', cadence: 'weekly', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03'] },
  { checkId: 'CA-RV-01', domain: 'revoke_readiness', title: 'Agent revoke/contain tabletop stale (>90d)', cadence: 'monthly', failSeverity: 'high', prototype: false, sisControls: ['SIS-CA-03', 'SIS-AG-09'] },
  { checkId: 'CA-RV-02', domain: 'revoke_readiness', title: 'Suspended/revoked agent still executing', cadence: 'continuous', failSeverity: 'critical', prototype: true, sisControls: ['SIS-CA-03', 'SIS-AG-09', 'SIS-GX-10'] },
] as const;

export const AssuranceEvidenceId = z
  .string()
  .min(6)
  .refine((value) => value.startsWith('cae_'), {
    message: 'AssuranceEvidenceId must start with "cae_"',
  })
  .brand('AssuranceEvidenceId');
export type AssuranceEvidenceId = z.infer<typeof AssuranceEvidenceId>;

export function newAssuranceEvidenceId(): AssuranceEvidenceId {
  return `cae_${randomUUID()}` as AssuranceEvidenceId;
}

export const AssuranceEvidence = z.object({
  evidenceId: AssuranceEvidenceId,
  checkId: AssuranceCheckId,
  tenantId: z.string().min(1),
  observedAt: z.string().datetime(),
  cadence: AssuranceCadence,
  status: AssuranceStatus,
  severity: AssuranceSeverity,
  summary: z.string().min(1),
  connector: z.object({
    system: z.string().min(1),
    query: z.string().min(1),
    evidenceUri: z.string().min(1).optional(),
  }),
  sisControls: z.array(z.string().min(1)).default([]),
  recommendedAction: z
    .object({
      playbookId: z.string().min(1),
      requiresApproval: z.boolean(),
      riskLevel: z.enum(['R0', 'R1', 'R2', 'R3']).optional(),
    })
    .optional(),
  owner: z.string().min(1).optional(),
  details: z.record(z.unknown()).default({}),
  verification: z
    .object({
      status: z.enum(['pending', 'verified', 'failed']),
      verifiedAt: z.string().datetime().nullable().optional(),
      method: z.string().min(1).optional(),
    })
    .optional(),
});
export type AssuranceEvidence = z.infer<typeof AssuranceEvidence>;

export interface AssuranceRunInput {
  tenantId: string;
  registered: readonly AgentActor[];
  observedAgentIds?: readonly string[];
  recentExecutions?: readonly ExecutionObject[];
  /** Gateway/Runtime health signal for CA-RT-01. */
  runtimeHealthy?: boolean;
  /** FeatureGate / kill-switch available. */
  killSwitchAvailable?: boolean;
  /** Denied execution count in the observation window (CA-AG-04). */
  recentDenyCount?: number;
  /** Total executions in the observation window (CA-AG-04). */
  recentExecutionCount?: number;
  checkIds?: readonly AssuranceCheckId[];
  now?: string;
}

export interface AssuranceRunResult {
  tenantId: string;
  ranAt: string;
  evidence: AssuranceEvidence[];
  failCount: number;
  unknownCount: number;
  passCount: number;
  prototypeCheckCount: number;
}

function def(checkId: AssuranceCheckId): AssuranceCheckDefinition {
  const found = ASSURANCE_CHECK_CATALOG.find((c) => c.checkId === checkId);
  if (!found) throw new Error(`unknown assurance check ${checkId}`);
  return found;
}

function evidenceBase(
  checkId: AssuranceCheckId,
  tenantId: string,
  now: string,
  status: AssuranceStatus,
  summary: string,
  connector: AssuranceEvidence['connector'],
  details: Record<string, unknown> = {},
  owner?: string,
): AssuranceEvidence {
  const meta = def(checkId);
  const severity = status === 'fail' ? meta.failSeverity : 'info';
  const requiresApproval =
    status === 'fail' &&
    (meta.failSeverity === 'critical' || meta.failSeverity === 'high');
  return AssuranceEvidence.parse({
    evidenceId: newAssuranceEvidenceId(),
    checkId,
    tenantId,
    observedAt: now,
    cadence: meta.cadence,
    status,
    severity,
    summary,
    connector,
    sisControls: meta.sisControls,
    ...(status === 'fail'
      ? {
          recommendedAction: {
            playbookId: `pb_${checkId.toLowerCase().replace(/-/g, '_')}`,
            requiresApproval,
            riskLevel: meta.failSeverity === 'critical' ? 'R3' : 'R2',
          },
        }
      : {}),
    ...(owner ? { owner } : {}),
    details,
    ...(status === 'fail'
      ? { verification: { status: 'pending', verifiedAt: null, method: `re-run ${checkId}` } }
      : {}),
  });
}

function stubUnknown(
  checkId: AssuranceCheckId,
  tenantId: string,
  now: string,
): AssuranceEvidence {
  return evidenceBase(
    checkId,
    tenantId,
    now,
    'unknown',
    `connector not wired in AIO-47 prototype (${checkId})`,
    {
      system: 'aion-assurance-prototype',
      query: `stub:${checkId}`,
    },
  );
}

/** CA-AG-01 — Execute-tier agents must have complete SIS-AG-02 registry. */
export function evaluateCaAg01(
  tenantId: string,
  agents: readonly AgentActor[],
  now: string,
): AssuranceEvidence {
  const incomplete = agents.filter((a) => {
    const execute =
      a.actionTier === 'execute' ||
      (a.actionTier === undefined &&
        (a.autonomyLevel === 'L2' ||
          a.autonomyLevel === 'L3' ||
          a.autonomyLevel === 'L4'));
    if (!execute) return false;
    return !registryCompleteness(a).ok;
  });
  if (incomplete.length === 0) {
    return evidenceBase(
      'CA-AG-01',
      tenantId,
      now,
      'pass',
      'all Execute-tier agents have complete SIS-AG-02 registry fields',
      {
        system: 'aion-runtime',
        query: 'GET /v1/registry/inventory',
      },
      { executeAgentCount: agents.filter((a) => a.actionTier === 'execute').length },
    );
  }
  return evidenceBase(
    'CA-AG-01',
    tenantId,
    now,
    'fail',
    `${incomplete.length} Execute-tier agent(s) missing SIS-AG-02 fields`,
    {
      system: 'aion-runtime',
      query: 'GET /v1/registry/inventory',
    },
    {
      agents: incomplete.map((a) => ({
        actorId: a.actorId,
        agentId: a.agentUri ?? a.agentId,
        missing: registryCompleteness(a).missing,
      })),
    },
    incomplete[0]?.owner,
  );
}

/** CA-AG-02 — observed agents must appear in the registry. */
export function evaluateCaAg02(
  tenantId: string,
  agents: readonly AgentActor[],
  observedAgentIds: readonly string[],
  now: string,
): AssuranceEvidence {
  const review = reviewAgentRegistry({
    registered: agents,
    observedAgentIds,
    now,
  });
  const unknowns = review.findings.filter((f) => f.code === 'unknown_agent');
  if (unknowns.length === 0) {
    return evidenceBase(
      'CA-AG-02',
      tenantId,
      now,
      'pass',
      'all observed agents are present in the Agent Identity Registry',
      {
        system: 'aion-runtime',
        query: 'GET /v1/registry/review',
      },
      { observedCount: observedAgentIds.length },
    );
  }
  return evidenceBase(
    'CA-AG-02',
    tenantId,
    now,
    'fail',
    `${unknowns.length} observed agent(s) not in registry (SIS-AG-10)`,
    {
      system: 'aion-runtime',
      query: 'GET /v1/registry/review',
    },
    { findings: unknowns },
  );
}

/**
 * CA-AG-03 — registered agents missing tools/data_scope/policy_version while
 * claiming Assist/Execute (permission drift / incomplete grants).
 */
export function evaluateCaAg03(
  tenantId: string,
  agents: readonly AgentActor[],
  now: string,
): AssuranceEvidence {
  const drifted = agents.filter((a) => {
    const tier = a.actionTier ?? 'assist';
    if (tier === 'observe') return false;
    const missingPolicy = !a.policyVersion?.trim();
    const emptyTools = a.allowedTools.length === 0 && tier === 'execute';
    const emptyData = a.allowedData.length === 0 && tier === 'execute';
    return missingPolicy || emptyTools || emptyData;
  });
  if (drifted.length === 0) {
    return evidenceBase(
      'CA-AG-03',
      tenantId,
      now,
      'pass',
      'Assist/Execute agents carry policy_version and non-empty grants where required',
      {
        system: 'aion-runtime',
        query: 'GET /v1/registry/agents',
      },
    );
  }
  return evidenceBase(
    'CA-AG-03',
    tenantId,
    now,
    'fail',
    `${drifted.length} agent(s) show tools/data_scope/policy_version drift`,
    {
      system: 'aion-runtime',
      query: 'GET /v1/registry/agents',
    },
    {
      agents: drifted.map((a) => ({
        actorId: a.actorId,
        agentId: a.agentUri ?? a.agentId,
        actionTier: a.actionTier,
        policyVersion: a.policyVersion ?? null,
        tools: a.allowedTools.length,
        dataScope: a.allowedData.length,
      })),
    },
    drifted[0]?.owner,
  );
}

/** CA-AG-04 — deny-rate spike heuristic (medium). */
export function evaluateCaAg04(
  tenantId: string,
  now: string,
  recentDenyCount: number,
  recentExecutionCount: number,
): AssuranceEvidence {
  const ratio =
    recentExecutionCount > 0 ? recentDenyCount / recentExecutionCount : 0;
  const spike = recentExecutionCount >= 5 && ratio >= 0.5;
  if (!spike) {
    return evidenceBase(
      'CA-AG-04',
      tenantId,
      now,
      'pass',
      `deny rate within threshold (denies=${recentDenyCount} total=${recentExecutionCount})`,
      {
        system: 'aion-data',
        query: 'executions.listRecentForTenant',
      },
      { recentDenyCount, recentExecutionCount, ratio },
    );
  }
  return evidenceBase(
    'CA-AG-04',
    tenantId,
    now,
    'fail',
    `deny spike: ${(ratio * 100).toFixed(0)}% of recent executions denied`,
    {
      system: 'aion-data',
      query: 'executions.listRecentForTenant',
    },
    { recentDenyCount, recentExecutionCount, ratio },
  );
}

/** CA-RT-01 — Runtime health + kill-switch availability. */
export function evaluateCaRt01(
  tenantId: string,
  now: string,
  runtimeHealthy: boolean,
  killSwitchAvailable: boolean,
): AssuranceEvidence {
  if (runtimeHealthy && killSwitchAvailable) {
    return evidenceBase(
      'CA-RT-01',
      tenantId,
      now,
      'pass',
      'Runtime healthy and FeatureGate kill path available',
      {
        system: 'aion-runtime',
        query: 'GET /healthz + FeatureGate',
      },
    );
  }
  return evidenceBase(
    'CA-RT-01',
    tenantId,
    now,
    'fail',
    `Runtime health=${runtimeHealthy} killSwitch=${killSwitchAvailable}`,
    {
      system: 'aion-runtime',
      query: 'GET /healthz + FeatureGate',
    },
    { runtimeHealthy, killSwitchAvailable },
  );
}

/** CA-RV-02 — revoked/suspended agents must not have recent executions. */
export function evaluateCaRv02(
  tenantId: string,
  agents: readonly AgentActor[],
  recentExecutions: readonly ExecutionObject[],
  now: string,
): AssuranceEvidence {
  const contained = new Set(
    agents
      .filter(
        (a) =>
          a.revocationState === 'revoked' || a.revocationState === 'suspended',
      )
      .flatMap((a) => [a.actorId, a.agentId, a.agentUri].filter(Boolean) as string[]),
  );
  const offenders = recentExecutions.filter((exe) => {
    if (contained.has(exe.actorId)) return true;
    if (exe.agentUri && contained.has(exe.agentUri)) return true;
    // Only count non-terminal denied as still "executing" after contain? Spec:
    // suspended/revoked still executing — any recent non-denied activity.
    return false;
  }).filter((exe) => exe.status !== 'denied' && exe.status !== 'cancelled');

  if (offenders.length === 0) {
    return evidenceBase(
      'CA-RV-02',
      tenantId,
      now,
      'pass',
      'no recent executions from suspended/revoked agents',
      {
        system: 'aion-runtime',
        query: 'registry + executions.listRecentForTenant',
      },
      { containedAgentCount: contained.size / 3 },
    );
  }
  return evidenceBase(
    'CA-RV-02',
    tenantId,
    now,
    'fail',
    `${offenders.length} recent execution(s) from suspended/revoked agents`,
    {
      system: 'aion-runtime',
      query: 'registry + executions.listRecentForTenant',
    },
    {
      executions: offenders.slice(0, 20).map((e) => ({
        executionId: e.executionId,
        actorId: e.actorId,
        agentUri: e.agentUri,
        status: e.status,
      })),
    },
  );
}

/**
 * Run Continuous Assurance checks. Prototype checks are evaluated; others
 * return `unknown` (fail-closed for scoring).
 */
export function runAssuranceChecks(input: AssuranceRunInput): AssuranceRunResult {
  const now = input.now ?? new Date().toISOString();
  const agents = input.registered.filter((a) => a.tenantId === input.tenantId);
  const requested =
    input.checkIds && input.checkIds.length > 0
      ? input.checkIds
      : ASSURANCE_CHECK_IDS;

  const evidence: AssuranceEvidence[] = [];
  for (const checkId of requested) {
    switch (checkId) {
      case 'CA-AG-01':
        evidence.push(evaluateCaAg01(input.tenantId, agents, now));
        break;
      case 'CA-AG-02':
        evidence.push(
          evaluateCaAg02(
            input.tenantId,
            agents,
            input.observedAgentIds ?? [],
            now,
          ),
        );
        break;
      case 'CA-AG-03':
        evidence.push(evaluateCaAg03(input.tenantId, agents, now));
        break;
      case 'CA-AG-04':
        evidence.push(
          evaluateCaAg04(
            input.tenantId,
            now,
            input.recentDenyCount ?? 0,
            input.recentExecutionCount ?? 0,
          ),
        );
        break;
      case 'CA-RT-01':
        evidence.push(
          evaluateCaRt01(
            input.tenantId,
            now,
            input.runtimeHealthy !== false,
            input.killSwitchAvailable !== false,
          ),
        );
        break;
      case 'CA-RV-02':
        evidence.push(
          evaluateCaRv02(
            input.tenantId,
            agents,
            input.recentExecutions ?? [],
            now,
          ),
        );
        break;
      default:
        evidence.push(stubUnknown(checkId, input.tenantId, now));
    }
  }

  return {
    tenantId: input.tenantId,
    ranAt: now,
    evidence,
    failCount: evidence.filter((e) => e.status === 'fail').length,
    unknownCount: evidence.filter((e) => e.status === 'unknown').length,
    passCount: evidence.filter((e) => e.status === 'pass').length,
    prototypeCheckCount: evidence.filter((e) =>
      (PROTOTYPE_ASSURANCE_CHECK_IDS as readonly string[]).includes(e.checkId),
    ).length,
  };
}
