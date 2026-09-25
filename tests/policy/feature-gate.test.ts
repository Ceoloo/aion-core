import { describe, it, expect } from 'vitest';
import {
  StaticFeatureGate,
  alwaysEnabledFeatureGate,
  resolveEnabled,
  agentEnabledFlag,
  isAgentEnabled,
  type FeatureGate,
} from '../../src/index.js';

describe('StaticFeatureGate', () => {
  it('fails open by default (unknown flag ⇒ enabled)', () => {
    const gate = new StaticFeatureGate();
    expect(gate.isEnabled('anything')).toBe(true);
  });

  it('honors a global flag value', () => {
    const gate = new StaticFeatureGate({ flags: { 'agent.revenue.enabled': false } });
    expect(gate.isEnabled('agent.revenue.enabled')).toBe(false);
  });

  it('applies a targeted override over the global value', () => {
    const gate = new StaticFeatureGate({
      flags: { 'agent.revenue.enabled': true },
      overrides: { 'agent.revenue.enabled@tenant:acme': false },
    });
    expect(gate.isEnabled('agent.revenue.enabled')).toBe(true);
    expect(
      gate.isEnabled('agent.revenue.enabled', { tenantId: 'acme' }),
    ).toBe(false);
    // A different tenant still gets the global value.
    expect(
      gate.isEnabled('agent.revenue.enabled', { tenantId: 'other' }),
    ).toBe(true);
  });

  it('prefers the most specific scope (agent over tenant)', () => {
    const gate = new StaticFeatureGate({
      overrides: {
        'agent.revenue.enabled@tenant:acme': true,
        'agent.revenue.enabled@agent:agent://aion/revenue/pipeline-ops/agt_1': false,
      },
    });
    expect(
      gate.isEnabled('agent.revenue.enabled', {
        tenantId: 'acme',
        agentUri: 'agent://aion/revenue/pipeline-ops/agt_1',
      }),
    ).toBe(false);
  });

  it('returns configured variants', () => {
    const gate = new StaticFeatureGate({ variants: { rollout: 'beta' } });
    expect(gate.variant('rollout')).toBe('beta');
    expect(gate.variant('missing')).toBeUndefined();
  });

  it('suppresses the variant when the flag is disabled (contract)', () => {
    // Globally off ⇒ no active variant.
    const off = new StaticFeatureGate({
      flags: { rollout: false },
      variants: { rollout: 'beta' },
    });
    expect(off.variant('rollout')).toBeUndefined();

    // A scoped override that disables the flag also suppresses the variant.
    const scoped = new StaticFeatureGate({
      flags: { rollout: true },
      variants: { rollout: 'beta' },
      overrides: { 'rollout@tenant:acme': false },
    });
    expect(scoped.variant('rollout')).toBe('beta');
    expect(scoped.variant('rollout', { tenantId: 'acme' })).toBeUndefined();
    expect(scoped.variant('rollout', { tenantId: 'other' })).toBe('beta');
  });

  it('respects an explicit fail-closed default', () => {
    const gate = new StaticFeatureGate({ defaultEnabled: false });
    expect(gate.isEnabled('unset')).toBe(false);
  });
});

describe('feature-gate helpers', () => {
  it('agentEnabledFlag builds the canonical kill-switch key', () => {
    expect(agentEnabledFlag('revenue')).toBe('agent.revenue.enabled');
  });

  it('isAgentEnabled reads the kill-switch flag', async () => {
    const gate = new StaticFeatureGate({ flags: { 'agent.media.enabled': false } });
    expect(await isAgentEnabled(gate, 'media')).toBe(false);
    expect(await isAgentEnabled(gate, 'revenue')).toBe(true); // unset ⇒ fail-open
  });

  it('resolveEnabled fails open when the provider throws', async () => {
    const brokenGate: FeatureGate = {
      isEnabled() {
        throw new Error('provider down');
      },
      variant() {
        return undefined;
      },
    };
    expect(await resolveEnabled(brokenGate, 'x')).toBe(true); // default fallback
    expect(await resolveEnabled(brokenGate, 'x', undefined, false)).toBe(false);
  });

  it('resolveEnabled falls back when an async provider never settles', async () => {
    const hangingGate: FeatureGate = {
      isEnabled() {
        return new Promise<boolean>(() => {}); // never resolves
      },
      variant() {
        return undefined;
      },
    };
    // Bounded wait: a stalled provider defers to the fallback instead of hanging.
    expect(await resolveEnabled(hangingGate, 'x', undefined, true, 10)).toBe(true);
    expect(await resolveEnabled(hangingGate, 'x', undefined, false, 10)).toBe(false);
  });

  it('alwaysEnabledFeatureGate is enabled for everything', () => {
    expect(alwaysEnabledFeatureGate.isEnabled('whatever')).toBe(true);
  });
});
