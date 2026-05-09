declare module 'streammark' {
  export class MarkdownStream {
    constructor();
    push(chunk: string): string;
    end(): string;
  }
}
