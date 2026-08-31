# AION Core — Implementation Architecture

This document describes *how* Phase 1 of `aion-core` is built. The *why* and the
authoritative contracts live in
[aion-docs](https://github.com/Ceoloo/aion-docs); this is the engineering
companion for people working in this repository.

## Design posture

- **Kernel, not application.** Core is a library you embed, not a server you
  deploy. There is no web server, queue, or database — only contracts and the
  orchestration logic that operates on them.
- **Deterministic control plane.** Every decision (policy, risk, gate, routing,
  state transition) is explicit and deterministic. Non-determinism belongs to
  execution runtimes, behind the adapter boundary.
- **Contracts first.** Boundary shapes are validated with [zod](https://zod.dev)
  and exported as branded types. Internally we pass typed values, not loose
  objects.
- **Ports, not infrastructure.** Persistence and observability are interfaces
  (`ports/`) with in-memory adapters (`adapters/`, `events/`, `approvals/`,
  `observability/`). Nothing in `src/` imports a database, broker, or vendor SDK.

## Module map

```
src/
├── contracts/       # owned shapes + factories (zod schemas → branded types)
├── errors/          # machine-readable domain errors (stable `code`)
├── ports/           # persistence/observability interfaces core depends on
├── adapters/        # in-memory RunRepository, MissionRepository
├── policy/          # PermissionEvaluator, RiskEvaluator, PolicyEngine
├── approvals/       # ApprovalGate + in-memory ApprovalStore
├── execution/       # ExecutionAdapter, ExecutionRegistry, MockExecutionAdapter
├── events/          # EventEmitter + in-memory EventSink
├── observability/   # Clock, TraceContext, Telemetry + in-memory sink
├── orchestration/   # run-context, lifecycle state machine, Orchestrator, wiring
└── index.ts         # the deliberate public API
```

## Identifiers and traceability

Every identity is a **branded string** with a stable prefix (`run_…`, `cmd_…`,
`req_…`). Branding stops a `RunId` being used where a `MissionId` is expected.
IDs are minted centrally (`generateId`) and threaded through a `TraceContext`
created when a command is received. The trace context is the single source of
the ID chain stamped onto every event and telemetry record, giving end-to-end
lineage (`request → mission → workflow → run`) plus `correlationId` (groups one
operation) and, on events, `causationId` (the event that caused this one).

## The orchestrator

`Orchestrator` is the kernel. `submit(command)` walks the lifecycle:

1. **normalize + validate** the command (zod → `ValidationError` on failure);
2. **create run context** (mint `runId`, `correlationId`); persist the `created`
   run;
3. **emit `command.received`** and a telemetry row;
4. **transition to `evaluating`** and run `PolicyEngine.evaluate`;
5. branch on the decision:
   - **DENY** → emit `policy.denied`, transition to `denied`, telemetry; return.
     *The execution registry is never touched.*
   - **REQUIRE_APPROVAL** → create an `ApprovalRequest` (carrying the command),
     transition to `awaiting_approval`, emit `approval.requested`; return a
     pending result.
   - **ALLOW** → emit `policy.allowed`, then execute.
6. **execute**: resolve an adapter by capability, transition to `executing`,
   emit `execution.started`, run the adapter, **normalize** the result (thrown
   errors and malformed results become a `failed` result), transition to
   `completed`/`failed`, emit `execution.completed`/`failed` + telemetry, and
   attach an `OutcomeReference`.

`resume({ approvalId, approve, decidedBy })` decides the gate through
`ApprovalGate`, loads the **same** run, and either transitions it to `denied`
(reject) or `approved` and re-enters the shared execute step (approve). Because
the `ApprovalRequest` stores the original command, resumption is deterministic
and never creates a second run.

The orchestrator holds no persistent state of its own; all run state lives in the
`RunRepository` port, so pausing and resuming works against any backing store.

## Policy, permissions, and risk

- **`PermissionEvaluator`** — deny-by-default. A capability is permitted only if
  it is in the actor's `permissions` and not in `forbiddenCapabilities`; a
  targeted tool must be in `allowedTools`.
- **`RiskEvaluator`** — classifies centrally by taking the **highest** of the
  available signals (declared risk, capability baseline, tool baseline, actor
  default). It can raise a declared risk but never lowers one.
- **`PolicyEngine`** — composes them into a structured `PolicyDecision` with an
  ordered `checks[]` trail. Evaluation order: permission → tool → risk-allowance
  (does classified risk exceed the actor's `maxRiskLevel`?) → approval
  requirement (R3 always gates; R2 gates when the capability is marked gated or
  `gateAllModerate` is set). Being *permitted* is not the same as being
  *cleared*.

## Human gate

`ApprovalGate` creates pending requests and records decisions, enforcing three
invariants: it **fails safe** (a run proceeds only on an explicit grant), a
**worker cannot approve its own gate** (the approver's identity must differ from
the run's worker), and each request **carries enough context to decide** (the
proposed command and its risk). Phase 1 has no UI/Slack/email — only the
contract.

## Execution boundary

`ExecutionAdapter` is the common contract every runtime implements (`canHandle`,
`execute`). `ExecutionRegistry` resolves the first adapter that can handle a
request (capability-based routing) and fails fast when none can. Core never sees
vendor- or model-specific detail: results are normalized to `ExecutionResult`,
with provider specifics confined to `metadata`. Phase 1 ships only
`MockExecutionAdapter`.

## Observability

`EventEmitter` writes past-tense **facts** to an `EventSink`; `Telemetry` writes
the operational **spine** to a `TelemetrySink`. Both stamp the trace context, so
events and telemetry are linked by shared IDs. Failures emit the same spine as
successes. All timestamps come from a single injectable `Clock` (UTC ISO-8601),
which also makes tests deterministic (`ManualClock`).

## Errors

All domain errors extend `AionError` with a stable `code` and structured
`details`, so consumers branch on `code`, never on message strings. Errors that
would otherwise escape as thrown surprises during execution are normalized into
a `failed` result instead — failure is a first-class, observable outcome.

## Testing strategy

- **Unit tests** cover identifiers, contract validation, the risk model,
  permission/risk/policy evaluation, the run state machine, the execution
  registry, the approval lifecycle, and the event/telemetry emitters.
- **Integration tests** drive the orchestrator through the four required
  scenarios (ALLOW, DENY, REQUIRE_APPROVAL + resume, execution failure) and
  assert trace continuity across events and telemetry.

Everything runs with no network, no database, and no provider SDK.
