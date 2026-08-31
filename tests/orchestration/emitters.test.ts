import { describe, it, expect } from 'vitest';
import {
  EventEmitter,
  InMemoryEventSink,
  Telemetry,
  InMemoryTelemetrySink,
  ManualClock,
  type TraceContext,
  newRequestId,
  newCorrelationId,
  newCommandId,
  newActorId,
  newRunId,
} from '../../src/index.js';

function trace(): TraceContext {
  return {
    requestId: newRequestId(),
    correlationId: newCorrelationId(),
    commandId: newCommandId(),
    actorId: newActorId(),
    actorType: 'agent',
    runId: newRunId(),
    agentId: undefined,
  };
}

describe('EventEmitter', () => {
  it('mints id + timestamp and stamps the trace spine', async () => {
    const clock = new ManualClock('2026-02-02T00:00:00.000Z');
    const sink = new InMemoryEventSink();
    const emitter = new EventEmitter(sink, clock);
    const ctx = trace();

    const evt = await emitter.emit({
      type: 'command.received',
      trace: ctx,
      payload: { k: 'v' },
    });

    expect(evt.eventId).toMatch(/^evt_/);
    expect(evt.timestamp).toBe('2026-02-02T00:00:00.000Z');
    expect(evt.requestId).toBe(ctx.requestId);
    expect(evt.correlationId).toBe(ctx.correlationId);
    expect(evt.runId).toBe(ctx.runId);
    expect(sink.all()).toHaveLength(1);
  });

  it('threads a causation chain', async () => {
    const emitter = new EventEmitter(new InMemoryEventSink(), new ManualClock());
    const ctx = trace();
    const first = await emitter.emit({ type: 'command.received', trace: ctx });
    const second = await emitter.emit({
      type: 'policy.allowed',
      trace: ctx,
      causationId: first.eventId,
    });
    expect(second.causationId).toBe(first.eventId);
  });
});

describe('Telemetry', () => {
  it('always carries risk and approval state when provided, plus the spine', async () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = new Telemetry(sink, new ManualClock());
    const ctx = trace();

    await telemetry.record({
      operation: 'execution',
      status: 'ok',
      trace: ctx,
      riskLevel: 'R2',
      approvalState: 'approved',
      executor: 'mock',
      durationMs: 5,
      cost: 3,
    });

    const [rec] = sink.forRun(ctx.runId!);
    expect(rec?.riskLevel).toBe('R2');
    expect(rec?.approvalState).toBe('approved');
    expect(rec?.executor).toBe('mock');
    expect(rec?.correlationId).toBe(ctx.correlationId);
  });
});
