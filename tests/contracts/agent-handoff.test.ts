import { describe, it, expect } from 'vitest';
import {
  AgentHandoff,
  createAgentHandoff,
  dispositionForHandoff,
  handoffRequiresHumanReview,
  newAgentId,
  newHandoffId,
  AGENT_HANDOFF_SCHEMA_VERSION,
} from '../../src/index.js';

describe('AgentHandoff contract', () => {
  it('createAgentHandoff mints hof_ id and schemaVersion 1', () => {
    const handoff = createAgentHandoff({
      kind: 'delegation',
      need: 'Review structured handoff schema',
      confidence: 0.82,
      fromLabel: 'AION — AI',
      toLabel: 'AION — RUNTIME',
      facts: [
        {
          statement: 'Zod contract lives in aion-core',
          evidenceRefs: ['art_spec'],
        },
      ],
      uncertainties: [
        {
          statement: 'Runtime transport path not wired yet',
          impact: 'medium',
          blocking: false,
          resolveBy: 'Runtime accepts AgentHandoff as command payload',
        },
      ],
      artifactRefs: [
        {
          id: 'art_spec',
          kind: 'file',
          ref: 'src/contracts/agent-handoff.ts',
          label: 'AgentHandoff schema',
        },
      ],
      recommendedAction: 'Validate and plan Runtime ingestion',
      decisionNeeded: 'Accept schema as platform handoff contract?',
    });

    expect(handoff.schemaVersion).toBe(AGENT_HANDOFF_SCHEMA_VERSION);
    expect(handoff.handoffId).toMatch(/^hof_/);
    expect(handoff.status).toBe('open');
    expect(handoff.facts).toHaveLength(1);
    expect(handoff.artifactRefs[0]?.kind).toBe('file');
    expect(handoff.confidence).toBe(0.82);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(() =>
      createAgentHandoff({
        kind: 'completion',
        need: 'x',
        confidence: 1.2,
      }),
    ).toThrow();
    expect(() =>
      AgentHandoff.parse({
        schemaVersion: '1',
        handoffId: newHandoffId(),
        kind: 'completion',
        need: 'x',
        confidence: -0.01,
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it('rejects unknown schemaVersion', () => {
    const result = AgentHandoff.safeParse({
      schemaVersion: '2',
      handoffId: newHandoffId(),
      kind: 'completion',
      need: 'x',
      confidence: 0.5,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidenceGate when escalateBelow > autoAcceptAbove', () => {
    expect(() =>
      createAgentHandoff({
        kind: 'delegation',
        need: 'bad gate',
        confidence: 0.6,
        confidenceGate: { escalateBelow: 0.9, autoAcceptAbove: 0.5 },
      }),
    ).toThrow();
  });

  it('disposition escalates on low confidence or blocking uncertainty', () => {
    const low = createAgentHandoff({
      kind: 'completion',
      need: 'low conf',
      confidence: 0.3,
    });
    expect(dispositionForHandoff(low)).toBe('escalate');
    expect(handoffRequiresHumanReview(low)).toBe(true);

    const blocked = createAgentHandoff({
      kind: 'dependency',
      need: 'blocked',
      confidence: 0.95,
      uncertainties: [
        {
          statement: 'Missing ExecutionRecord fields',
          blocking: true,
          impact: 'high',
        },
      ],
      fromAgentId: newAgentId(),
      toAgentId: newAgentId(),
      blocking: true,
    });
    expect(dispositionForHandoff(blocked)).toBe('escalate');

    const strong = createAgentHandoff({
      kind: 'completion',
      need: 'done',
      confidence: 0.9,
      facts: [{ statement: 'Tests green' }],
    });
    expect(dispositionForHandoff(strong)).toBe('accept');
    expect(handoffRequiresHumanReview(strong)).toBe(false);

    const mid = createAgentHandoff({
      kind: 'delegation',
      need: 'mid',
      confidence: 0.7,
    });
    expect(dispositionForHandoff(mid)).toBe('proceed_with_caution');
  });

  it('honors explicit confidenceGate overrides', () => {
    const handoff = createAgentHandoff({
      kind: 'completion',
      need: 'gated',
      confidence: 0.6,
      confidenceGate: { escalateBelow: 0.4, autoAcceptAbove: 0.55 },
    });
    expect(dispositionForHandoff(handoff)).toBe('accept');
  });
});
