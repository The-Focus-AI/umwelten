/**
 * Renders a tool invocation part as it streams.
 *
 * Each tool part in useChat's message.parts has a type like `tool-<name>`
 * and a `state` field: 'input-streaming' → 'input-available' → 'output-available'
 * Plus: input, output, toolCallId.
 */

interface ToolPart {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function ToolCallCard({ part }: { part: ToolPart }) {
  const toolName = part.type.replace(/^tool-/, '');
  const state = part.state ?? 'unknown';
  const isError = !!part.errorText;

  return (
    <div className={`tool-card ${isError ? 'tool-card-error' : ''}`}>
      <div className="tool-header">
        <code className="tool-name">{toolName}</code>
        <span className="tool-state">{state}</span>
      </div>
      {part.input != null && (
        <details className="tool-input">
          <summary>input</summary>
          <pre>{JSON.stringify(part.input, null, 2)}</pre>
        </details>
      )}
      {part.output != null && (
        <details className="tool-output" open>
          <summary>output</summary>
          <pre>{JSON.stringify(part.output, null, 2)}</pre>
        </details>
      )}
      {isError && <div className="tool-error">{part.errorText}</div>}
    </div>
  );
}
