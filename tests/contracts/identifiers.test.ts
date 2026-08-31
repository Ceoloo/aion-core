import { describe, it, expect } from 'vitest';
import {
  generateId,
  newRunId,
  newRequestId,
  defaultIdGenerator,
  RunId,
} from '../../src/index.js';

describe('identifiers', () => {
  it('generates prefixed ids per kind', () => {
    expect(newRunId()).toMatch(/^run_/);
    expect(newRequestId()).toMatch(/^req_/);
    expect(generateId('ApprovalId')).toMatch(/^apr_/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRunId()));
    expect(ids.size).toBe(1000);
  });

  it('validates/parses a branded id via its schema', () => {
    const id = newRunId();
    expect(() => RunId.parse(id)).not.toThrow();
    expect(() => RunId.parse('')).toThrow();
  });

  it('exposes a default generator matching generateId', () => {
    expect(defaultIdGenerator.generate('CommandId')).toMatch(/^cmd_/);
  });
});
