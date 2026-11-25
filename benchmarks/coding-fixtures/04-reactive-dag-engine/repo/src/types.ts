export type Listener<T> = (value: T) => void;

export interface ReactiveCell<T> {
  readonly id: number;
  get(): T;
  subscribe(listener: Listener<T>): () => void;
}

export interface Signal<T> extends ReactiveCell<T> {
  set(next: T): void;
}

export interface Computed<T> extends ReactiveCell<T> {
  readonly recomputeCount: number;
}

export class CycleError extends Error {
  constructor(message: string = "Dependency cycle detected in reactive graph") {
    super(message);
    this.name = "CycleError";
  }
}
