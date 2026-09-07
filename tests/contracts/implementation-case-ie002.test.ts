import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_REQUIRED_STEPS,
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

function toBlueprintApproved() {
  let c = createImplementationCase({
    tenantId: 'aion-systems',
    clientRef: 'client-acme',
    clientName: 'Acme Services',
    ownerId: 'operator-alex',
    commercialStatus: 'paid',
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

describe('IE-002 provisioning + activation gate', () => {
  it('refuses activation_ready until every required step is verified', () => {
    let c = toBlueprintApproved();
    expect(c.commercialStatus).toBe('paid');
    expect(c.deliveryStatus).toBe('blueprint_approved');

    c = startProvisioning(c, 'operator-alex', NOW);
    expect(c.deliveryStatus).toBe('provisioning');
    expect(c.blockers).toEqual(
      expect.arrayContaining([
        'blocked:ghl_connection',
        'blocked:model_access',
        'blocked:workflow_activation',
      ]),
    );

    expect(() => markActivationReady(c, 'operator-alex', NOW)).toThrow(
      /unverified steps/,
    );
  });

  it('verifies steps with evidence then activation_ready → human activate → active', () => {
    let c = toBlueprintApproved();
    c = startProvisioning(c, 'operator-alex', NOW);

    for (const key of ACTIVATION_REQUIRED_STEPS) {
      c = updateProvisioningStep(
        c,
        {
          key,
          status: 'verified',
          evidence: `manual proof for ${key}`,
          completedBy: 'operator-alex',
        },
        NOW,
      );
    }

    expect(c.blockers).toEqual([]);
    c = markActivationReady(c, 'operator-alex', NOW);
    expect(c.deliveryStatus).toBe('activation_ready');

    expect(() =>
      activateImplementation(c, '', NOW),
    ).toThrow(/approvedBy/);

    c = activateImplementation(c, 'operator-alex', NOW);
    expect(c.deliveryStatus).toBe('active');
    expect(c.metadata?.['activatedBy']).toBe('operator-alex');
    expect(c.nextAction).toMatch(/OL-001/);
  });

  it('rejects invisible verification without evidence/actor', () => {
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
        evidence: 'location XYZ connected',
      }),
    ).toThrow(/completedBy/);
  });
});
