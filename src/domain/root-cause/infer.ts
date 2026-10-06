import { invariant } from '../errors.ts';
import type { CausalEdge, CausalObservation, RootCauseResult } from '../types.ts';

type Traversal = { path: string[]; score: number };

function findPaths(start: string, edges: CausalEdge[], seen: string[] = []): Traversal[] {
  const nextSeen = [...seen, start];
  const incoming = edges.filter((edge) => edge.to === start);
  if (!incoming.length) return [{ path: nextSeen, score: 1 }];
  return incoming.flatMap((edge) => {
    if (nextSeen.includes(edge.from)) return [{ path: [...nextSeen, edge.from], score: edge.weight }];
    return findPaths(edge.from, edges, nextSeen).map((item) => ({ path: item.path, score: item.score * edge.weight }));
  });
}

function rankPath(path: string[], observation: CausalObservation, score: number): { node: string; score: number; path: string[] } {
  const distancePenalty = 1 / Math.max(1, path.length - 1);
  return { node: path[0], score: observation.score * score * distancePenalty, path };
}

export function inferRootCauses(observations: CausalObservation[], edges: CausalEdge[]): RootCauseResult {
  for (const observation of observations) invariant(observation.score >= 0 && observation.score <= 1, 'INVALID_OBSERVATION_SCORE', 'Observation score must be in [0, 1]', { id: observation.id });
  for (const edge of edges) invariant(edge.weight > 0 && edge.weight <= 1 && edge.delayMs >= 0, 'INVALID_CAUSAL_EDGE', 'Causal edge has invalid weight or delay', { edge });
  const rejectedCycles: string[][] = [];
  const rankedPaths: Array<{ node: string; score: number; path: string[] }> = [];
  for (const observation of observations) {
    const paths = findPaths(observation.node, edges);
    for (const path of paths) {
      if (new Set(path.path).size !== path.path.length) {
        rejectedCycles.push(path.path);
        continue;
      }
      rankedPaths.push(rankPath(path.path, observation, path.score));
    }
  }
  const scores = new Map<string, { score: number; paths: string[][] }>();
  for (const item of rankedPaths) {
    const current = scores.get(item.node) ?? { score: 0, paths: [] };
    current.score += item.score;
    current.paths.push(item.path);
    scores.set(item.node, current);
  }
  return { ranking: [...scores.entries()].map(([node, value]) => ({ node, score: value.score, paths: value.paths })).sort((a, b) => b.score - a.score || a.node.localeCompare(b.node)), observations, rejectedCycles };
}
