# Bridge System Workflow

## Core Principle

**NEVER clone repos to host computer. Everything happens inside Dagger containers.**

## Standard Operating Procedure

### Step 1: Start Basic Container

- Use base image (node:20 for most projects)
- Clone repo into container at /workspace
- Start MCP bridge server

### Step 2: Analyze Scripts

- Use bridge client to list files in /workspace/bin/
- Read each script to detect:
  - Command usage (jq, curl, imagemagick, etc.)
  - Environment variables needed
  - File dependencies
  - Shebang lines (#!/bin/bash, #!/usr/bin/env python3, etc.)

### Step 3: Determine Requirements

- Map detected commands to apt packages
- Identify npm packages needed
- List environment variables
- Check for specific versions

### Step 4: Reprovision Container

- Stop current bridge
- Create new provisioning config with:
  - Correct apt packages
  - Setup commands (npm install, etc.)
  - Required secrets
- Start new bridge with updated config

### Step 5: Verify & Run

- Confirm all tools are available
- Run scripts
- Monitor output
- Install any missed dependencies if needed

## Current Task: trmnl-image-agent

### Scripts to Analyze

1. run.sh - Main entry point
2. bin/fetch-weather-raw
3. bin/fetch-mohawk
4. bin/fetch-sun-moon
5. bin/parse-data
6. bin/generate-image
7. bin/process-image
8. bin/update-display

### Requirements Detected So Far

From previous run logs:

- jq (JSON parsing)
- chromium + chromium-driver (headless browser)
- curl (HTTP requests)
- imagemagick (image processing)
- git (already in node:20)
- Optional: claude-code, 1password-cli (may not be needed for core functionality)

### Next Steps

1. Start bridge with node:20
2. Read run.sh to see workflow
3. Read each bin/ script to check requirements
4. Reprovision with correct apt packages
5. Run run.sh
