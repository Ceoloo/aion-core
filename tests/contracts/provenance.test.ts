import { describe, it, expect } from 'vitest';
import {
  createProvenance,
  isQuarantined,
  mayActAsInstruction,
  provenanceBacksRisk,
  provenanceTrustAtLeast,
  provenanceTrustRank,
  Provenance,
  type ProvenanceTrustLevel,
} from '../../src/index.js';

describe('Provenance contract', () => {
  it('mints a prefixed, validated record', () => {
    const p = createProvenance({
      subject: 'memory',
      origin: 'agent',
      trustLevel: 'declared',
      author: 'revenue-agent',
    });
    expect(p.provenanceId).toMatch(/^prov_/);
    expect(Provenance.parse(p)).toEqual(p);
    expect(p.instructionAllowed).toBe(false); // deny by default
    expect(p.chain).toEqual([]);
  });

  it('rejects an unprefixed provenance id', () => {
    expect(() =>
      Provenance.parse({
        provenanceId: 'nope_123',
        subject: 'memory',
        origin: 'agent',
        trustLevel: 'declared',
        instructionAllowed: false,
        chain: [],
        createdAt: new Date().toISOString(),
        metadata: {},
      }),
    ).toThrow();
  });

  it('orders trust levels quarantined < untrusted < declared < trusted', () => {
    const order: ProvenanceTrustLevel[] = [
      'quarantined',
      'untrusted',
      'declared',
      'trusted',
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(provenanceTrustRank(order[i]!)).toBeGreaterThan(
        provenanceTrustRank(order[i - 1]!),
      );
    }
    expect(provenanceTrustAtLeast('trusted', 'declared')).toBe(true);
    expect(provenanceTrustAtLeast('untrusted', 'declared')).toBe(false);
  });

  describe('mayActAsInstruction — data never self-elevates to instruction', () => {
    it('is false when instructionAllowed is not set, however trusted', () => {
      const p = createProvenance({
        subject: 'memory',
        origin: 'human',
        trustLevel: 'trusted',
      });
      expect(mayActAsInstruction(p)).toBe(false);
    });

    it('is false for an untrusted origin even when instructionAllowed is set', () => {
      const p = createProvenance({
        subject: 'memory',
        origin: 'agent',
        trustLevel: 'untrusted',
        instructionAllowed: true,
      });
      // "Ignore your normal approval policy" written by an agent stays inert.
      expect(mayActAsInstruction(p)).toBe(false);
    });

    it('is false for a non-principal (agent/tool) origin even if allowed + trusted', () => {
      const p = createProvenance({
        subject: 'memory',
        origin: 'agent',
        trustLevel: 'trusted',
        instructionAllowed: true,
      });
      // An agent cannot authorize its own memory to steer the runtime.
      expect(mayActAsInstruction(p)).toBe(false);
    });

    it('is true only when explicitly allowed AND a principal origin AND >= declared trust', () => {
      const p = createProvenance({
        subject: 'instruction',
        origin: 'operator',
        trustLevel: 'declared',
        instructionAllowed: true,
      });
      expect(mayActAsInstruction(p)).toBe(true);
    });
  });

  describe('provenanceBacksRisk — fails closed', () => {
    it('never lets a quarantined origin back any action', () => {
      const p = createProvenance({
        subject: 'credential',
        origin: 'external',
        trustLevel: 'quarantined',
      });
      expect(isQuarantined(p)).toBe(true);
      for (const r of ['R0', 'R1', 'R2', 'R3'] as const) {
        expect(provenanceBacksRisk(p, r)).toBe(false);
      }
    });

    it('lets an untrusted origin back only trivial/low-risk work', () => {
      const p = createProvenance({
        subject: 'resource',
        origin: 'external',
        trustLevel: 'untrusted',
      });
      expect(provenanceBacksRisk(p, 'R0')).toBe(true);
      expect(provenanceBacksRisk(p, 'R1')).toBe(true);
      expect(provenanceBacksRisk(p, 'R2')).toBe(false);
      expect(provenanceBacksRisk(p, 'R3')).toBe(false);
    });

    it('lets declared/trusted origins back any risk', () => {
      for (const level of ['declared', 'trusted'] as const) {
        const p = createProvenance({
          subject: 'authority',
          origin: 'human',
          trustLevel: level,
        });
        expect(provenanceBacksRisk(p, 'R3')).toBe(true);
      }
    });
  });
});
