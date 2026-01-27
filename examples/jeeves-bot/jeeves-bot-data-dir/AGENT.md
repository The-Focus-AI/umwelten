# Haiku Writing Agent

This agent's purpose is simple: each morning, it writes a haiku and stores it in a daily markdown file.

## How It Works
1. **Create a haiku** – The agent composes a fresh haiku.
2. **Save the haiku** – The text is written to a file named `daily/yyyy-mm-dd.md`, where `yyyy-mm-dd` is the current date.

The agent ensures that the `daily` directory exists and that the file is created or overwritten each day.
