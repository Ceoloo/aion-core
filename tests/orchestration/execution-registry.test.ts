import { describe, it, expect } from 'vitest';
import {
  ExecutionRegistry,
  MockExecutionAdapter,
  ExecutorNotFoundError,
  capability,
  type ExecutionRequest,
  newRunId,
  newRequestId,
  newCommandId,
  createAgentActor,
  Command,
} from '../../src/index.js';

function request(cap: string): ExecutionRequest {
  const actor = createAgentActor({
    name: 'A',
    purpose: 'p',
    owner: 'o',
    permissions: [capability(cap)],
  });
  const command = Command.parse({
    commandId: newCommandId(),
    requestId: newRequestId(),
    name: 'X',
    actor,
    capability: capability(cap),
    createdAt: new Date().toISOString(),
  });
  return {
    runId: newRunId(),
    requestId: command.requestId,
    capability: capability(cap),
    command,
    riskLevel: 'R1',
  };
}

describe('ExecutionRegistry', () => {
  it('resolves an adapter that advertises the capability', () => {
    const registry = new ExecutionRegistry().register(
      new MockExecutionAdapter({
        name: 'research',
        capabilities: [capability('research.summary')],
      }),
    );
    const adapter = registry.resolve(request('research.summary'));
    expect(adapter?.name).toBe('research');
  });

  it('returns undefined / throws when no adapter handles the capability', () => {
    const registry = new ExecutionRegistry().register(
      new MockExecutionAdapter({
        name: 'research',
        capabilities: [capability('research.summary')],
      }),
    );
    expect(registry.resolve(request('deployment.execute'))).toBeUndefined();
    expect(() => registry.resolveOrThrow(request('deployment.execute'))).toThrow(
      ExecutorNotFoundError,
    );
  });

  it('resolves in registration (priority) order', () => {
    const registry = new ExecutionRegistry()
      .register(new MockExecutionAdapter({ name: 'first' }))
      .register(new MockExecutionAdapter({ name: 'second' }));
    expect(registry.resolve(request('any.thing'))?.name).toBe('first');
    expect(registry.registeredNames()).toEqual(['first', 'second']);
  });
});
