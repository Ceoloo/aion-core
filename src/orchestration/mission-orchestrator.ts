import type { Actor } from '../contracts/actor.js';
import type { Mission } from '../contracts/mission.js';
import type { Workflow, WorkflowStep } from '../contracts/workflow.js';
import type { ExecutionId } from '../contracts/identifiers.js';
import { newExecutionId, newRequestId } from '../contracts/identifiers.js';
import { ValidationError, NotFoundError } from '../errors/index.js';
import type { Clock } from '../observability/clock.js';
import type { WorkflowRepository } from '../ports/workflow-repository.js';
import type { MissionRepository } from '../ports/mission-repository.js';
import type {
  Orchestrator} from './orchestrator.js';
import {
  type OrchestrationResult,
} from './orchestrator.js';

/**
 * One step outcome inside a Mission orchestration.
 *
 * `executionId` is minted here so Runtime can persist an Execution Object with
 * correct parent/root lineage without inventing a second identity scheme.
 */
export interface MissionStepResult {
  stepIndex: number;
  step: WorkflowStep;
  status: OrchestrationResult['status'];
  executionId: ExecutionId;
  parentExecutionId?: ExecutionId;
  rootExecutionId: ExecutionId;
  orchestration: OrchestrationResult;
}

export type MissionOrchestrationStatus =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'awaiting_approval';

export interface MissionOrchestrationResult {
  status: MissionOrchestrationStatus;
  mission: Mission;
  workflow: Workflow;
  rootExecutionId: ExecutionId;
  steps: MissionStepResult[];
  /** Index of the step that paused/failed/denied, when not fully completed. */
  stoppedAtStep?: number;
}

export interface MissionRunInput {
  missionId: string;
  workflowId: string;
  actor: Actor;
  /**
   * Optional per-step payloads keyed by step index (string) or step name.
   * Used for client-money path payloads (e.g. GHL-shaped contact upsert).
   */
  stepPayloads?: Record<string, Record<string, unknown>>;
  /** Resume after approval — continue from this step index (inclusive). */
  resumeFromStep?: number;
  /**
   * When resuming, pass the root execution id minted on the first run so
   * subsequent children stay under the same lineage tree.
   */
  rootExecutionId?: ExecutionId;
  /**
   * When resuming after a gated step completed, pass that step's execution id
   * as the parent of the next child.
   */
  parentExecutionId?: ExecutionId;
  /** Optional request-id prefix for idempotent step submits. */
  requestIdPrefix?: string;
  metadata?: Record<string, unknown>;
}

export interface MissionOrchestratorDeps {
  orchestrator: Orchestrator;
  missions: MissionRepository;
  workflows: WorkflowRepository;
  clock?: Clock;
}

/**
 * MissionOrchestrator — Mission 004 sequential multi-step runner.
 *
 * Given a Mission + Workflow definition, submits each step as a governed
 * command through the single-command {@link Orchestrator}. Child steps share
 * `missionId` / `workflowId` and carry parent/root execution lineage so fan-out
 * can be reconstructed after restart.
 *
 * Stops on DENY, failure, or REQUIRE_APPROVAL (awaiting_approval). Resume by
 * calling {@link run} again with `resumeFromStep` after the gate is decided.
 *
 * This is deliberately NOT a parallel DAG engine — sequential MVP only.
 */
export class MissionOrchestrator {
  constructor(private readonly deps: MissionOrchestratorDeps) {}

  async run(input: MissionRunInput): Promise<MissionOrchestrationResult> {
    const mission = await this.deps.missions.get(input.missionId as never);
    if (!mission) {
      throw new NotFoundError(`mission "${input.missionId}" not found`, {
        missionId: input.missionId,
      });
    }
    const workflow = await this.deps.workflows.get(input.workflowId as never);
    if (!workflow) {
      throw new NotFoundError(`workflow "${input.workflowId}" not found`, {
        workflowId: input.workflowId,
      });
    }
    if (workflow.steps.length < 1) {
      throw new ValidationError('workflow must contain at least one step', {
        workflowId: workflow.workflowId,
      });
    }

    const startIndex = input.resumeFromStep ?? 0;
    if (startIndex < 0 || startIndex >= workflow.steps.length) {
      throw new ValidationError('resumeFromStep out of range', {
        resumeFromStep: startIndex,
        stepCount: workflow.steps.length,
      });
    }

    const rootExecutionId =
      input.rootExecutionId ?? (startIndex === 0 ? newExecutionId() : undefined);
    if (!rootExecutionId) {
      throw new ValidationError(
        'rootExecutionId is required when resumeFromStep > 0',
        { resumeFromStep: startIndex },
      );
    }

    const steps: MissionStepResult[] = [];
    let parentExecutionId: ExecutionId | undefined =
      input.parentExecutionId ??
      (startIndex === 0 ? undefined : input.parentExecutionId);
    // First step of a fresh run is the root execution itself.
    let currentRootChildParent: ExecutionId | undefined = parentExecutionId;

    for (let i = startIndex; i < workflow.steps.length; i += 1) {
      const step = workflow.steps[i]!;
      const executionId =
        i === 0 && startIndex === 0 ? rootExecutionId : newExecutionId();
      const parentForStep =
        i === 0 && startIndex === 0 ? undefined : currentRootChildParent;
      const payload = resolveStepPayload(input.stepPayloads, i, step.name);

      const orchestration = await this.deps.orchestrator.submit({
        name: `${workflow.name}.${step.name}`,
        actor: input.actor,
        capability: step.capability,
        riskLevel: step.riskLevel,
        missionId: mission.missionId,
        workflowId: workflow.workflowId,
        executionId,
        ...(parentForStep ? { parentExecutionId: parentForStep } : {}),
        rootExecutionId,
        tenantId:
          'tenantId' in input.actor && typeof input.actor.tenantId === 'string'
            ? input.actor.tenantId
            : undefined,
        requestId: input.requestIdPrefix
          ? (`${input.requestIdPrefix}:step:${i}` as never)
          : newRequestId(),
        payload,
        metadata: {
          ...(input.metadata ?? {}),
          missionOrchestration: {
            stepIndex: i,
            stepName: step.name,
            parentExecutionId: parentForStep,
            rootExecutionId,
            executionId,
          },
        },
      });

      const stepResult: MissionStepResult = {
        stepIndex: i,
        step,
        status: orchestration.status,
        executionId,
        ...(parentForStep ? { parentExecutionId: parentForStep } : {}),
        rootExecutionId,
        orchestration,
      };
      steps.push(stepResult);

      if (orchestration.status === 'awaiting_approval') {
        return {
          status: 'awaiting_approval',
          mission,
          workflow,
          rootExecutionId,
          steps,
          stoppedAtStep: i,
        };
      }
      if (orchestration.status === 'denied') {
        return {
          status: 'denied',
          mission,
          workflow,
          rootExecutionId,
          steps,
          stoppedAtStep: i,
        };
      }
      if (orchestration.status === 'failed') {
        return {
          status: 'failed',
          mission,
          workflow,
          rootExecutionId,
          steps,
          stoppedAtStep: i,
        };
      }

      // completed — next child parents to this execution
      currentRootChildParent = executionId;
    }

    return {
      status: 'completed',
      mission,
      workflow,
      rootExecutionId,
      steps,
    };
  }
}

function resolveStepPayload(
  payloads: Record<string, Record<string, unknown>> | undefined,
  index: number,
  name: string,
): Record<string, unknown> {
  if (!payloads) return {};
  return payloads[String(index)] ?? payloads[name] ?? {};
}
