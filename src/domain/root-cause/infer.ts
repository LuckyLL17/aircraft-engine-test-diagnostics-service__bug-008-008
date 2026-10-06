import { invariant } from '../errors.ts';
import type { CausalEdge, CausalObservation, RootCauseResult } from '../types.ts';

type Traversal = {
  path: string[];
  weight: number;
  delayMs: number;
};

function traceBackward(
  node: string,
  edges: CausalEdge[],
  seen: string[],
  rejectedCycles: string[][],
): Traversal[] {
  const path = [...seen, node];
  const incoming = edges.filter((edge) => edge.to === node);

  if (incoming.length === 0) return [{ path, weight: 1, delayMs: 0 }];

  const paths: Traversal[] = [];
  for (const edge of incoming) {
    if (path.includes(edge.from)) {
      // Keep the complete backward trace, including the edge that closes the loop.
      rejectedCycles.push([...path, edge.from]);
      continue;
    }

    for (const upstream of traceBackward(edge.from, edges, path, rejectedCycles)) {
      paths.push({
        path: upstream.path,
        weight: upstream.weight * edge.weight,
        delayMs: upstream.delayMs + edge.delayMs,
      });
    }
  }
  return paths;
}

function scorePath(observation: CausalObservation, traversal: Traversal): number {
  const distance = traversal.path.length - 1;
  const distanceFactor = 1 / Math.max(1, distance);
  const delayFactor = Math.exp(-traversal.delayMs / 1000);
  return observation.score * traversal.weight * distanceFactor * delayFactor;
}

export function inferRootCauses(observations: CausalObservation[], edges: CausalEdge[]): RootCauseResult {
  for (const observation of observations) invariant(observation.score >= 0 && observation.score <= 1, 'INVALID_OBSERVATION_SCORE', 'Observation score must be in [0, 1]', { id: observation.id });
  for (const edge of edges) invariant(edge.weight > 0 && edge.weight <= 1 && edge.delayMs >= 0, 'INVALID_CAUSAL_EDGE', 'Causal edge has invalid weight or delay', { edge });

  const rejectedCycles: string[][] = [];
  const merged = new Map<string, { score: number; paths: string[][] }>();

  for (const observation of observations) {
    const paths = traceBackward(observation.node, edges, [], rejectedCycles);
    for (const traversal of paths) {
      const rootCause = traversal.path[traversal.path.length - 1];
      const current = merged.get(rootCause) ?? { score: 0, paths: [] };
      current.score += scorePath(observation, traversal);
      current.paths.push(traversal.path);
      merged.set(rootCause, current);
    }
  }

  const ranking = [...merged.entries()]
    .map(([node, value]) => ({ node, score: value.score, paths: value.paths }))
    .sort((a, b) => b.score - a.score || a.node.localeCompare(b.node));

  return { ranking, observations, rejectedCycles };
}
