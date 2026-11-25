export interface GraphNode {
  readonly id: number;
  readonly sources: Set<GraphNode>;
  readonly dependents: Set<GraphNode>;
  onDependencyInvalidated(): void;
}

const activeStack: GraphNode[] = [];

export function getActiveConsumer(): GraphNode | undefined {
  return activeStack[activeStack.length - 1];
}

export function pushConsumer(node: GraphNode): void {
  activeStack.push(node);
}

export function popConsumer(): void {
  activeStack.pop();
}

export function linkDependency(source: GraphNode, dependent: GraphNode): void {
  source.dependents.add(dependent);
  dependent.sources.add(source);
}

export function unlinkAllSources(dependent: GraphNode): void {
  for (const src of dependent.sources) {
    src.dependents.delete(dependent);
  }
  dependent.sources.clear();
}
