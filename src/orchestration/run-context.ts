import type { Command } from '../contracts/command.js';
import type { Run } from '../contracts/run.js';
import { newRunId, newCorrelationId } from '../contracts/identifiers.js';
import type { TraceContext } from '../observability/trace-context.js';
import type { Clock } from '../observability/clock.js';

/**
 * RunContext bundles the three things every lifecycle step needs: the run
 * record (mutable state), the trace context (propagated IDs), and the command
 * (intent). It is created once when the orchestrator receives a command and
 * threaded through the rest of the lifecycle — including across a human-gate
 * pause, so the SAME run resumes on approval.
 */
export interface RunContext {
  run: Run;
  trace: TraceContext;
  command: Command;
}

/** Creates the initial RunContext (state `created`) for a command. */
export function createRunContext(command: Command, clock: Clock): RunContext {
  const runId = newRunId();
  const correlationId = newCorrelationId();
  const now = clock.isoNow();

  const run: Run = {
    runId,
    requestId: command.requestId,
    ...(command.missionId ? { missionId: command.missionId } : {}),
    ...(command.workflowId ? { workflowId: command.workflowId } : {}),
    commandId: command.commandId,
    actorId: command.actor.actorId,
    state: 'created',
    correlationId,
    createdAt: now,
    updatedAt: now,
  };

  const trace: TraceContext = {
    requestId: command.requestId,
    correlationId,
    commandId: command.commandId,
    actorId: command.actor.actorId,
    actorType: command.actor.actorType,
    runId,
    ...(command.missionId ? { missionId: command.missionId } : {}),
    ...(command.workflowId ? { workflowId: command.workflowId } : {}),
    ...(command.actor.actorType === 'agent'
      ? { agentId: command.actor.agentId }
      : {}),
    ...(command.toolId ? { toolId: command.toolId } : {}),
  };

  return { run, trace, command };
}

/**
 * Reconstructs a RunContext from a stored run and its originating command —
 * used when a paused run is resumed after a human decision.
 */
export function restoreRunContext(run: Run, command: Command): RunContext {
  const trace: TraceContext = {
    requestId: run.requestId,
    correlationId: run.correlationId,
    commandId: run.commandId,
    actorId: run.actorId,
    actorType: command.actor.actorType,
    runId: run.runId,
    ...(run.missionId ? { missionId: run.missionId } : {}),
    ...(run.workflowId ? { workflowId: run.workflowId } : {}),
    ...(command.actor.actorType === 'agent'
      ? { agentId: command.actor.agentId }
      : {}),
    ...(command.toolId ? { toolId: command.toolId } : {}),
  };
  return { run, trace, command };
}
