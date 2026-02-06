/**
 * Build exec arguments for running a bash command under timeout in a container.
 * Uses array form (no shell string) so the command is passed as a single argv
 * and no shell escaping is needed—avoids $VAR expansion and injection issues.
 */

/**
 * Returns argv for container exec: timeout, timeoutSeconds, bash, -c, command.
 * The command is passed as one argument to bash -c, so special characters
 * (quotes, $VAR, newlines, etc.) are preserved and not interpreted by an outer shell.
 */
export function buildTimeoutBashExecArgs(command: string, timeoutSeconds: number): string[] {
  return ['timeout', String(timeoutSeconds), 'bash', '-c', command];
}
