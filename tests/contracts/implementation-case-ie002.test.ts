import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_REQUIRED_STEPS,
  ImplementationCase,
  activateImplementation,
  applyIntake,
  approveBlueprint,
  attachBlueprintDraft,
  createImplementationCase,
  draftBlueprintFromCase,
  markActivationReady,
  startProvisioning,
  updateProvisioningStep,
  type ImplementationIntake,
} from '../../src/index.js';

const NOW = '2026-09-07T12:00:00.000Z';

function readyIntake(
  overrides: Partial<ImplementationIntake> = {},
): ImplementationIntake {
  return {
    businessContext: 'Service business losing leads after inquiry',
    primaryBottleneck: 'leads_lost_inquiry_followup',
    measurableProblem: 'Follow-up starts >24h after inquiry 60% of the time',
    namedOwner: 'operator-alex',
    accessReady: true,
    approvedScope: true,
    deliveryCapacityFeasible: true,
    outOfScope: false,
    needsDiscovery: false,
    modelAccessStatus: 'pending',
    ...overrides,
  };
}

function toBlueprintApproved(commercialStatus: 'prospect' | 'paid' = 'paid') {
  let c = createImplementationCase({
    tenantId: 'aion-systems',
    clientRef: 'client-acme',
    clientName: 'Acme Services',
    ownerId: 'operator-alex',
    commercialStatus,
    createdAt: NOW,
  });
  c = applyIntake(c, readyIntake({ completedBy: 'operator-alex' }), NOW);
  const draft = draftBlueprintFromCase({
    caseRecord: c,
    packageKey: 'revenue_os',
    deliveryOwner: 'operator-alex',
    now: NOW,
  });
  c = attachBlueprintDraft(c, draft, NOW);
  return approveBlueprint(c, 'operator-alex', NOW);
}

function verifyAll(c: ReturnType<typeof toBlueprintApproved>) {
  let next = c;
  next = startProvisioning(next, 'operator-alex', NOW);
  for (const key of ACTIVATION_REQUIRED_STEPS) {
    next = updateProvisioningStep(
      next,
      {
        key,
        status: 'verified',
        evidence: `manual proof for ${key}`,
        completedBy: 'operator-alex',
      },
      NOW,
    );
  }
  return next;
}

describe('IE-002 acceptance matrix', () => {
  it('rejects start provisioning before blueprint approval', () => {
    const draft = createImplementationCase({
      tenantId: 'aion-systems',
      clientRef: 'client-early',
      clientName: 'Early',
      ownerId: 'ops',
      createdAt: NOW,
    });
    expect(() => startProvisioning(draft, 'ops', NOW)).toThrow(
      /illegal delivery transition/,
    );
  });

  it('rejects verify without evidence or completedBy', () => {
    let c = toBlueprintApproved();
    c = startProvisioning(c, 'operator-alex', NOW);
    expect(() =>
      updateProvisioningStep(c, {
        key: 'ghl_connection',
        status: 'verified',
        completedBy: 'operator-alex',
      }),
    ).toThrow(/evidence/);
    expect(() =>
      updateProvisioningStep(c, {
        key: 'ghl_connection',
        status: 'verified',
        evidence: 'location connected',
      }),
    ).toThrow(/completedBy/);
  });

  it('rejects activation_ready when a required step is missing', () => {
    let c = toBlueprintApproved();
    c = startProvisioning(c, 'operator-alex', NOW);
    for (const key of ACTIVATION_REQUIRED_STEPS.slice(0, -1)) {
      c = updateProvisioningStep(
        c,
        {
          key,
          status: 'verified',
          evidence: `proof-${key}`,
          completedBy: 'ops',
        },
        NOW,
      );
    }
    expect(() => markActivationReady(c, 'ops', NOW)).toThrow(/unverified steps/);
  });

  it('reaches activation_ready after all required steps, then enforces approvedBy', () => {
    let c = verifyAll(toBlueprintApproved());
    c = markActivationReady(c, 'operator-alex', NOW);
    expect(c.deliveryStatus).toBe('activation_ready');
    expect(() => activateImplementation(c, '', NOW)).toThrow(/approvedBy/);
    c = activateImplementation(c, 'operator-alex', NOW);
    expect(c.deliveryStatus).toBe('active');
  });

  it('re-activate of already-active case is idempotent', () => {
    let c = verifyAll(toBlueprintApproved());
    c = markActivationReady(c, 'ops', NOW);
    c = activateImplementation(c, 'ops', NOW);
    const again = activateImplementation(c, 'ops-other', NOW);
    expect(again.deliveryStatus).toBe('active');
    expect(again.caseId).toBe(c.caseId);
    expect(again.metadata?.['activatedBy']).toBe('ops');
  });

  it('commercial status change alone never causes activation', () => {
    const paidDraft = createImplementationCase({
      tenantId: 'aion-systems',
      clientRef: 'client-paid',
      clientName: 'Paid Only',
      ownerId: 'ops',
      commercialStatus: 'paid',
      createdAt: NOW,
    });
    expect(paidDraft.deliveryStatus).toBe('draft');

    const bumped = ImplementationCase.parse({
      ...paidDraft,
      commercialStatus: 'paid',
      metadata: { ...paidDraft.metadata, invoice: 'INV-1' },
    });
    expect(bumped.deliveryStatus).toBe('draft');
    expect(bumped.commercialStatus).toBe('paid');
    expect(() => activateImplementation(bumped, 'ops', NOW)).toThrow(
      /illegal delivery transition|cannot activate/,
    );
  });
});
