# task-list

A Claude Code mod that shows Claude's plan in a pane beside the conversation. Claude writes the plan when it starts a task with two or more steps. It marks one task as doing while it works, and marks each task done when it finishes. You can see what Claude is doing and what is left, without reading the whole transcript.

Works in the Claude Code terminal and in the Code tab of the Claude desktop app.

## Use it

- Type `/tasklist` to show or hide the pane.
- Or press the Tasks button in the footer, under the prompt.

The pane never opens by itself. Claude keeps the list current while the pane is hidden, so it is ready when you open it.

## What it adds to Claude Code

- A tool, `set_tasks`. Claude sends the full list on each call. The tool stays in the prompt, so Claude does not have to look it up first.
- A short rule in the system prompt. It tells Claude when to make a list and how to keep it current.
- A short note in a tool result that only Claude reads. It comes when Claude makes 6 tool calls without an update while tasks are still open. It also comes once per request when Claude makes 4 tool calls with no list. Tool calls by subagents do not count.
- The `/tasklist` command, the Tasks button and the pane.

## What it does not do

It makes no network calls, writes no files and sends nothing outside Claude Code. The list stays in Claude Code's own plugin state.

## Tests

```bash
claude plugin test .
```
