import type { GraphNode } from "./graph.ts";

/**
 * Traverse reachable downstream nodes starting from `roots` in topological order.
 */
export function topologicalOrder(roots: readonly GraphNode[]): GraphNode[] {
  const visited = new Set<GraphNode>();
  const postOrder: GraphNode[] = [];

  function visit(node: GraphNode): void {
    if (visited.has(node)) return;
    visited.add(node);
    for (const dep of node.dependents) {
      visit(dep);
    }
    postOrder.push(node);
  }

  for (const root of roots) {
    visit(root);
  }
  return postOrder.reverse();
}
