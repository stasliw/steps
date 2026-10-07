# Privacy policy for Steps

Last updated: 7 October 2026

Steps is a Claude Code mod. It runs only inside Claude Code, on your own computer.

## What it handles

Steps handles the steps that Claude sends to its `set_steps` tool: a short title and a status (todo, doing or done) for each step. It also counts the tool calls in the current session, so it can remind Claude to keep the list current.

## Where it keeps them

Steps keeps the list and the counts in memory, for the current session only. When the session ends or the mod reloads, they are gone. Steps writes no files and saves nothing.

## What it sends

Steps makes no network calls. It sends no data to its author or to anyone else.

Steps adds a short rule to Claude's system prompt and short notes to some tool results. These go to Claude as part of your normal Claude Code session, under your Claude Code data settings, the same as the rest of the conversation.

## Personal data

Steps does not ask for, read or store personal data. A step title holds what Claude writes in it, and it stays only in memory, as described above.

## Contact

Open an issue at https://github.com/stasliw/steps/issues.
