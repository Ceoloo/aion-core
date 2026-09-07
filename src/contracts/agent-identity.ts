import { z } from 'zod';

/**
 * Canonical agent identity URI.
 *
 * Pattern (Execution Platform Week 1):
 *   agent://aion/{domain}/{role}/{id}
 *
 * Examples:
 *   agent://aion/revenue/pipeline-ops/agt_…
 *   agent://aion/media/script-writer/agt_…
 *
 * Never identify an agent solely by a human-readable title ("Chief of Staff").
 * The URI is the attributable handle used in Execution Objects, permissions,
 * and the agent registry.
 */

export const AGENT_URI_PREFIX = 'agent://aion/' as const;

const AGENT_URI_PATTERN =
  /^agent:\/\/aion\/([a-z][a-z0-9_-]*)\/([a-z][a-z0-9_-]*)\/([a-zA-Z0-9._:-]+)$/;

export const AgentUri = z
  .string()
  .regex(
    AGENT_URI_PATTERN,
    'agentUri must match agent://aion/{domain}/{role}/{id}',
  );
export type AgentUri = z.infer<typeof AgentUri>;

export interface AgentUriParts {
  domain: string;
  role: string;
  id: string;
}

/** Build a canonical agent URI from domain, role, and stable id (usually agentId). */
export function formatAgentUri(parts: AgentUriParts): AgentUri {
  const domain = parts.domain.trim().toLowerCase();
  const role = parts.role.trim().toLowerCase();
  const id = parts.id.trim();
  return AgentUri.parse(`agent://aion/${domain}/${role}/${id}`);
}

/** Parse a canonical agent URI into domain / role / id. */
export function parseAgentUri(uri: string): AgentUriParts {
  const parsed = AgentUri.parse(uri);
  const match = AGENT_URI_PATTERN.exec(parsed);
  if (!match) {
    // Unreachable when AgentUri.parse succeeded; keeps the type checker honest.
    throw new Error(`invalid agentUri: ${uri}`);
  }
  return { domain: match[1]!, role: match[2]!, id: match[3]! };
}
