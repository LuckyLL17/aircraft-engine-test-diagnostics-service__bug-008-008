import { invariant } from '../errors.ts';
import type { CausalEdge, CausalObservation, RootCauseResult } from '../types.ts';

type Traversal = {
  path: string[];
  weight: number;
  delayMs: number;
};

function findPaths(
  start: string,
  edges: CausalEdge[],
  rejectedCycles: string[][],
  seen: string[] = [],
  weight = 1,
  delayMs = 0,
): Traversal[] {
  const path = [...seen, start];
  const incoming = edges.filter((edge) => edge.to === start);

  // Paths preserve reverse-trace order: observation, intermediate causes, root.
  // A source reached after at least one reverse edge is an upstream root.
  // A source-less observation itself is only a symptom and must not be ranked.
  if (!incoming.length) return path.length > 1 ? [{ path, weight, delayMs }] : [];

  return incoming.flatMap((edge) => {
    const nextWeight = weight * edge.weight;
    const nextDelayMs = delayMs + edge.delayMs;

    if (path.includes(edge.from)) {
      rejectedCycles.push([...path, edge.from]);
      return [];
    }

    return findPaths(edge.from, edges, rejectedCycles, path, nextWeight, nextDelayMs);
  });
}

function rankPath(
  traversal: Traversal,
  observation: CausalObservation,
): { node: string; score: number; path: string[] } {
  const distance = traversal.path.length - 1;
  const effectiveDelayMs = Math.max(1, traversal.delayMs);
  const score = observation.score * traversal.weight / distance / effectiveDelayMs;
  return { node: traversal.path[traversal.path.length - 1], score, path: traversal.path };
}

export function inferRootCauses(observations: CausalObservation[], edges: CausalEdge[]): RootCauseResult {
  for (const observation of observations) invariant(observation.score >= 0 && observation.score <= 1, 'INVALID_OBSERVATION_SCORE', 'Observation score must be in [0, 1]', { id: observation.id });
  for (const edge of edges) invariant(edge.weight > 0 && edge.weight <= 1 && edge.delayMs >= 0, 'INVALID_CAUSAL_EDGE', 'Causal edge has invalid weight or delay', { edge });

  const rejectedCycles: string[][] = [];
  const merged = new Map<string, { score: number; paths: string[][] }>();

  for (const observation of observations) {
    const paths = findPaths(observation.node, edges, rejectedCycles);
    for (const traversal of paths) {
      const ranked = rankPath(traversal, observation);
      const current = merged.get(ranked.node);
      if (current) {
        current.score += ranked.score;
        current.paths.push(ranked.path);
      } else {
        merged.set(ranked.node, { score: ranked.score, paths: [ranked.path] });
      }
    }
  }

  const ranking = [...merged.entries()]
    .map(([node, value]) => ({ node, score: value.score, paths: value.paths }))
    .sort((a, b) => b.score - a.score || a.node.localeCompare(b.node));

  return { ranking, observations, rejectedCycles };
}
