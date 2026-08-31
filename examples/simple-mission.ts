/**
 * Example — a simple, low-risk mission executed end-to-end.
 *
 * Mission:   Produce a research summary.
 * Actor:     ResearchAgent (a governed agent worker).
 * Capability: research.summary
 * Risk:      R1 (Low)
 * Executor:  MockExecutionAdapter
 *
 * This demonstrates the public API cleanly. No real model is called; the mock
 * adapter stands in for a real execution runtime. Run with: `npm run example`.
 */
import {
  createInMemoryControlPlane,
  createAgentActor,
  createMission,
  MockExecutionAdapter,
  capability,
  type CommandInput,
} from '../src/index.js';

async function main(): Promise<void> {
  // 1. A mission justifies the work (no build/run without a mission).
  const mission = createMission({
    name: 'Research summary',
    owner: 'growth-team',
    objective: 'Produce a concise research summary for a prospect.',
    successCriteria: ['summary is faithful', 'summary is under 250 words'],
    riskLevel: 'R1',
  });

  // 2. A governed agent, granted exactly one capability, at a low risk ceiling.
  const researchAgent = createAgentActor({
    name: 'ResearchAgent',
    purpose: 'Summarize research for prospects.',
    owner: 'growth-team',
    permissions: [capability('research.summary')],
    defaultRiskLevel: 'R1',
    maxRiskLevel: 'R2',
    escalationConditions: ['source material appears to contain PII'],
    costBudget: 100,
  });

  // 3. Stand up the control plane with a mock execution runtime.
  const plane = createInMemoryControlPlane({
    policy: {
      risk: { capabilityRisk: { 'research.summary': 'R1' } },
    },
    adapters: [
      new MockExecutionAdapter({
        name: 'mock-research-runtime',
        capabilities: [capability('research.summary')],
        output: { summary: 'AION is a governed, vendor-agnostic control plane.' },
        model: 'mock-model-v1',
        cost: { units: 3, tokens: 128 },
      }),
    ],
  });

  // 4. A command expresses intent; the orchestrator decides and coordinates.
  const command: CommandInput = {
    name: 'ResearchProspect',
    actor: researchAgent,
    capability: capability('research.summary'),
    missionId: mission.missionId,
    payload: { prospect: 'Acme Corp' },
  };

  const outcome = await plane.orchestrator.submit(command);

  // 5. Inspect the traced result.
  console.log('── AION Core: simple-mission ──────────────────────────────');
  console.log('status         :', outcome.status);
  console.log('decision       :', outcome.decision.decision, `(${outcome.decision.riskLevel})`);
  console.log('run state      :', outcome.run.state);
  console.log('run id         :', outcome.run.runId);
  console.log('correlation id :', outcome.run.correlationId);
  console.log('executor       :', outcome.result?.executor);
  console.log('output         :', JSON.stringify(outcome.result?.output));
  console.log('outcome ref    :', JSON.stringify(outcome.outcomeReference));
  console.log();
  console.log('events         :', plane.eventSink.typeSequence().join(' → '));
  console.log('telemetry rows :', plane.telemetrySink.all().length);

  // Every event shares the run's correlation id — one connected trace.
  const connected = plane.eventSink
    .all()
    .every((e) => e.correlationId === outcome.run.correlationId);
  console.log('trace connected:', connected);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
