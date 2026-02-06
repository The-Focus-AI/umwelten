import { describe, it, expect } from 'vitest';
import { buildTimeoutBashExecArgs } from './dagger-exec-args.js';

describe('buildTimeoutBashExecArgs', () => {
  it('returns timeout, seconds, bash, -c, command', () => {
    const args = buildTimeoutBashExecArgs('echo hello', 60);
    expect(args).toEqual(['timeout', '60', 'bash', '-c', 'echo hello']);
  });

  it('passes command as single argv element (no shell interpolation)', () => {
    const command = 'echo $HOME';
    const args = buildTimeoutBashExecArgs(command, 30);
    expect(args).toHaveLength(5);
    expect(args[4]).toBe('echo $HOME');
  });

  it('preserves double quotes in command', () => {
    const command = 'echo "hello world"';
    const args = buildTimeoutBashExecArgs(command, 10);
    expect(args[4]).toBe('echo "hello world"');
  });

  it('preserves single quotes in command', () => {
    const command = "echo 'hello world'";
    const args = buildTimeoutBashExecArgs(command, 10);
    expect(args[4]).toBe("echo 'hello world'");
  });

  it('preserves mixed quotes and dollar signs', () => {
    const command = 'echo "price: $99"';
    const args = buildTimeoutBashExecArgs(command, 5);
    expect(args[4]).toBe('echo "price: $99"');
  });

  it('preserves newlines in command', () => {
    const command = 'echo line1\necho line2';
    const args = buildTimeoutBashExecArgs(command, 5);
    expect(args[4]).toBe('echo line1\necho line2');
  });

  it('preserves backslashes in command', () => {
    const command = 'echo \\n';
    const args = buildTimeoutBashExecArgs(command, 5);
    expect(args[4]).toBe('echo \\n');
  });

  it('preserves semicolons (no injection)', () => {
    const command = 'echo a; echo b';
    const args = buildTimeoutBashExecArgs(command, 5);
    expect(args[4]).toBe('echo a; echo b');
  });

  it('converts timeout to string', () => {
    const args = buildTimeoutBashExecArgs('true', 300);
    expect(args[1]).toBe('300');
  });
});
