import { describe, it, expect } from 'vitest';
import {
  ApprovalGate,
  InMemoryApprovalStore,
  PolicyEngine,
  Command,
  capability,
  createAgentActor,
  createHumanActor,
  ManualClock,
  PermissionDeniedError,
  InvalidStateTransitionError,
  NotFoundError,
  newRequestId,
  newCommandId,
  newRunId,
  newActorId,
} from '../../src/index.js';

const clock = new ManualClock();

function highRiskCommand() {
  const actor = createAgentActor({
    name: 'Deployer',
    purpose: 'deploy',
    owner: 'o',
    permissions: [capability('deployment.execute')],
    maxRiskLevel: 'R3',
  });
  const command = Command.parse({
    commandId: newCommandId(),
    requestId: newRequestId(),
    name: 'DeployApplication',
    actor,
    capability: capability('deployment.execute'),
    createdAt: clock.isoNow(),
  });
  const decision = new PolicyEngine(
    { risk: { capabilityRisk: { 'deployment.execute': 'R3' } } },
    { clock },
  ).evaluate(command);
  return { actor, command, decision };
}

describe('ApprovalGate', () => {
  it('creates a pending request carrying the command and risk', async () => {
    const gate = new ApprovalGate(new InMemoryApprovalStore(), clock);
    const { command, decision } = highRiskCommand();
    const runId = newRunId();
    const req = await gate.request(command, runId, decision);
    expect(req.status).toBe('pending');
    expect(req.runId).toBe(runId);
    expect(req.riskLevel).toBe('R3');
    expect(req.command.commandId).toBe(command.commandId);
  });

  it('grants a pending gate by a different human', async () => {
    const gate = new ApprovalGate(new InMemoryApprovalStore(), clock);
    const { command, decision } = highRiskCommand();
    const req = await gate.request(command, newRunId(), decision);
    const approver = createHumanActor({ name: 'Boss', maxRiskLevel: 'R3' });
    const decided = await gate.decide({
      approvalId: req.approvalId,
      approve: true,
      decidedBy: approver.actorId,
    });
    expect(decided.status).toBe('granted');
    expect(decided.decidedBy).toBe(approver.actorId);
  });

  it('refuses to let a worker approve its own gate', async () => {
    const gate = new ApprovalGate(new InMemoryApprovalStore(), clock);
    const { command, decision } = highRiskCommand();
    const req = await gate.request(command, newRunId(), decision);
    await expect(
      gate.decide({
        approvalId: req.approvalId,
        approve: true,
        decidedBy: command.actor.actorId, // same identity as the worker
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('rejects a second decision on an already-decided gate', async () => {
    const gate = new ApprovalGate(new InMemoryApprovalStore(), clock);
    const { command, decision } = highRiskCommand();
    const req = await gate.request(command, newRunId(), decision);
    await gate.decide({
      approvalId: req.approvalId,
      approve: false,
      decidedBy: newActorId(),
    });
    await expect(
      gate.decide({
        approvalId: req.approvalId,
        approve: true,
        decidedBy: newActorId(),
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('throws NotFoundError for an unknown gate', async () => {
    const gate = new ApprovalGate(new InMemoryApprovalStore(), clock);
    await expect(
      gate.decide({
        approvalId: 'apr_missing' as never,
        approve: true,
        decidedBy: newActorId(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
