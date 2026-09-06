import type { z } from 'zod';
import {
  newActorId,
  newAgentId,
  newToolId,
  newMissionId,
  newWorkflowId,
} from './identifiers.js';
import {
  HumanActor,
  AgentActor,
  ServiceActor,
  SystemActor,
} from './actor.js';
import { formatAgentUri } from './agent-identity.js';
import { Mission } from './mission.js';
import { Tool } from './tool.js';
import { Workflow } from './workflow.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';

/**
 * Ergonomic constructors.
 *
 * These validate against the contract schemas (so callers get a parsed, branded
 * value) while minting identifiers and timestamps when omitted. They keep the
 * public API pleasant without weakening the contracts.
 */

type HumanActorInput = Omit<
  z.input<typeof HumanActor>,
  'actorType' | 'actorId'
> & { actorId?: string };

export function createHumanActor(input: HumanActorInput): HumanActor {
  return HumanActor.parse({
    ...input,
    actorType: 'human',
    actorId: input.actorId ?? newActorId(),
  });
}

type AgentActorInput = Omit<
  z.input<typeof AgentActor>,
  'actorType' | 'actorId' | 'agentId'
> & { actorId?: string; agentId?: string };

export function createAgentActor(input: AgentActorInput): AgentActor {
  const agentId = input.agentId ?? newAgentId();
  const domain = input.domain;
  const role = input.role;
  const agentUri =
    input.agentUri ??
    (domain && role
      ? formatAgentUri({ domain, role, id: agentId })
      : undefined);

  return AgentActor.parse({
    ...input,
    actorType: 'agent',
    actorId: input.actorId ?? newActorId(),
    agentId,
    domain,
    role,
    agentUri,
  });
}

type ServiceActorInput = Omit<
  z.input<typeof ServiceActor>,
  'actorType' | 'actorId'
> & { actorId?: string };

export function createServiceActor(input: ServiceActorInput): ServiceActor {
  return ServiceActor.parse({
    ...input,
    actorType: 'service',
    actorId: input.actorId ?? newActorId(),
  });
}

type SystemActorInput = Omit<
  z.input<typeof SystemActor>,
  'actorType' | 'actorId'
> & { actorId?: string };

export function createSystemActor(input: SystemActorInput): SystemActor {
  return SystemActor.parse({
    ...input,
    actorType: 'system',
    actorId: input.actorId ?? newActorId(),
  });
}

type MissionInput = Omit<
  z.input<typeof Mission>,
  'missionId' | 'createdAt'
> & { missionId?: string; createdAt?: string };

export function createMission(
  input: MissionInput,
  clock: Clock = systemClock,
): Mission {
  return Mission.parse({
    ...input,
    missionId: input.missionId ?? newMissionId(),
    createdAt: input.createdAt ?? clock.isoNow(),
  });
}

type ToolInput = Omit<z.input<typeof Tool>, 'toolId'> & { toolId?: string };

export function createTool(input: ToolInput): Tool {
  return Tool.parse({
    ...input,
    toolId: input.toolId ?? newToolId(),
  });
}

type WorkflowInput = Omit<z.input<typeof Workflow>, 'workflowId'> & {
  workflowId?: string;
};

export function createWorkflow(input: WorkflowInput): Workflow {
  return Workflow.parse({
    ...input,
    workflowId: input.workflowId ?? newWorkflowId(),
  });
}
