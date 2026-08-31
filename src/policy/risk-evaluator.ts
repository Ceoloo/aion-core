import type { Capability } from '../contracts/capability.js';
import type { RiskLevel } from '../contracts/risk.js';
import { highestRisk } from '../contracts/risk.js';

/** How a capability maps to a baseline risk level. */
export type CapabilityRiskMap = Partial<Record<string, RiskLevel>>;

export interface RiskEvaluatorConfig {
  /** Baseline risk per capability, e.g. { "email.send": "R3" }. */
  capabilityRisk?: CapabilityRiskMap;
  /** Risk assigned to a capability with no explicit mapping. */
  defaultRisk?: RiskLevel;
}

export interface RiskClassificationInput {
  capability: Capability;
  /** Caller-declared risk from the command, if any. */
  declaredRisk?: RiskLevel;
  /** The requested tool's baseline risk, if a tool is targeted. */
  toolRisk?: RiskLevel;
  /** The actor's default risk (agents carry one), if any. */
  actorDefaultRisk?: RiskLevel;
}

export interface RiskClassification {
  riskLevel: RiskLevel;
  reason: string;
}

/**
 * RiskEvaluator.
 *
 * Classifies the risk of an action centrally. Per
 * aion-docs/governance/risk-levels.md, risk is "classified centrally, never
 * lowered by the executing worker": the evaluator takes the HIGHEST of every
 * available signal (declared risk, capability baseline, tool baseline, actor
 * default). It can raise a declared risk but never lowers one.
 */
export class RiskEvaluator {
  private readonly capabilityRisk: CapabilityRiskMap;
  private readonly defaultRisk: RiskLevel;

  constructor(config: RiskEvaluatorConfig = {}) {
    this.capabilityRisk = config.capabilityRisk ?? {};
    this.defaultRisk = config.defaultRisk ?? 'R1';
  }

  classify(input: RiskClassificationInput): RiskClassification {
    const capabilityRisk =
      this.capabilityRisk[input.capability] ?? this.defaultRisk;

    const signals: RiskLevel[] = [capabilityRisk];
    if (input.declaredRisk) signals.push(input.declaredRisk);
    if (input.toolRisk) signals.push(input.toolRisk);
    if (input.actorDefaultRisk) signals.push(input.actorDefaultRisk);

    const riskLevel = highestRisk(signals);
    return {
      riskLevel,
      reason: `classified ${riskLevel} as the highest of [${signals.join(', ')}] for capability "${input.capability}"`,
    };
  }
}
