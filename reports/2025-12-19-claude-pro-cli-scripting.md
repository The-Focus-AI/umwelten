# Quick Research: Using Claude Pro Subscription from CLI Scripts

*Date: 2025-12-19 | Sources: 10*

## Summary

- **Claude Code** is Anthropic's official CLI tool that allows Pro/Max subscribers to use their subscription directly from the terminal without API endpoints [1]
- Use the `-p` (or `--print`) flag for non-interactive scripting: `claude -p "your prompt"` [2]
- **Critical**: If `ANTHROPIC_API_KEY` is set, Claude Code will use API billing instead of your subscription - unset it to use Pro benefits [3]
- The **Claude Agent SDK** (Python/TypeScript) provides programmatic access but requires an API key - it does not support Pro subscription authentication [4]
- Pro subscription provides ~10-40 Code prompts per 5-hour window; Max plans offer significantly more [3]

## Key Sources

- [Claude Code Headless Mode Docs](https://code.claude.com/docs/en/headless): Official documentation for non-interactive `-p` flag usage and scripting
- [Using Claude Code with Pro/Max Plans](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan): Subscription-based authentication and usage limits
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview): SDK requires API key authentication, not subscription-based
- [Claude Code CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference): Complete CLI flag reference

## How It Works

### Installation
```bash
npm install -g @anthropic-ai/claude-code
```

### Authentication (Using Pro Subscription)
```bash
# First, ensure no API key is set
unset ANTHROPIC_API_KEY

# Start claude and login with your Pro account
claude
/login
```

### Non-Interactive Scripting with `-p` Flag
```bash
# Basic usage
claude -p "Summarize this project"

# With JSON output for parsing
claude -p "What does this code do?" --output-format json

# Pipe input
cat file.txt | claude -p "Summarize this"

# Allow specific tools
claude -p "Fix the tests" --allowedTools "Bash,Read,Edit"

# Continue conversation
claude -p "Explain more" --continue
```

### Example: Git Automation
```bash
git log --oneline -n 10 | claude -p "Create release notes from these commits"
```

## Notable Quotes

> "If you have an ANTHROPIC_API_KEY environment variable set on your system, Claude Code will use this API key for authentication instead of your Claude subscription...resulting in API usage charges." - [Claude Help Center](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan) [3]

> "Unless previously approved, we do not allow third party developers to offer Claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods described in this document instead." - [Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/overview) [4]

## Key Limitations

| Approach | Subscription Auth | API Key Required | Best For |
|----------|-------------------|------------------|----------|
| `claude -p` CLI | Yes | No | Simple scripts, one-off tasks |
| Agent SDK (Python/TS) | No | Yes | Production apps, complex agents |

## Further Research Needed

- Whether there are rate limiting strategies to maximize Pro subscription usage in scripts
- Community tools that may wrap Claude Code CLI for enhanced scripting workflows
- Whether Anthropic plans to add subscription-based auth to the Agent SDK in the future

## References

1. [Claude Code Product Page](https://claude.com/product/claude-code) - Official product overview
2. [Claude Code Headless Mode](https://code.claude.com/docs/en/headless) - Non-interactive scripting documentation
3. [Using Claude Code with Pro/Max Plans](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan) - Subscription usage and limits
4. [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - SDK requires API key, not subscription
5. [Claude Code CLI Reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference) - Complete CLI documentation
6. [GitHub: anthropics/claude-code](https://github.com/anthropics/claude-code) - Official repository
7. [NPM: @anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) - Package installation
8. [Medium: Claude CLI Setup Guide](https://medium.com/@riccardo.bernardi.advisor/unlocking-claude-pros-power-how-to-set-up-and-use-the-claude-cli-tool-like-a-pro-against-github-d29f8f682a03) - Third-party setup tutorial
9. [Shipyard: Claude Code Cheatsheet](https://shipyard.build/blog/claude-code-cheat-sheet/) - Comprehensive command reference
10. [ClaudeLog: --print Flag Explanation](https://claudelog.com/faqs/what-is-print-flag-in-claude-code/) - Detailed flag documentation
