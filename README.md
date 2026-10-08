# Steps

A Claude Code mod that shows Claude's plan in a pane beside the conversation. Claude writes the steps when it starts work that has two or more of them. It marks one step as doing while it works, and marks each step done when it finishes. You can see what Claude is doing and what is left, without reading the whole transcript.

Works in the Claude Code terminal and in the Code tab of the Claude desktop app.

## Use it

- Type `/steps` to show or hide the pane.
- Or press the Steps button in the footer, under the prompt.

The pane never opens by itself. Claude keeps the list current while the pane is hidden, so it is ready when you open it.

When you set a goal with `/goal`, the pane shows it above the list: "Goal" in bold beside a target, then the goal in regular text. `/goal clear` removes it. A goal that Claude proposes and you accept shows the same way.

## Tools and commands this mod answers

- `mcp__steps__set_steps`, on every call. This is the mod's own tool, which it registers at session start. Claude Code serves a tool that a mod registers only through that mod's `tool.call` hook, so the hook is the whole tool: no other tool runs in its place. The mod answers no other tool.
- `/steps`, on every run. This is the mod's own command, which it registers at session start. It shows or hides the pane. The mod answers no other command.

## What each hook does

All hooks are in `hooks/register.tsx`.

- `session.start` registers the `set_steps` tool and the `/steps` command, then passes the event on unchanged.
- `tool.call` for `mcp__steps__set_steps` answers the mod's own `set_steps` tool. It checks the list, keeps it in the mod's memory, redraws the pane and returns a one-line count.
- `tool.call` for every other tool runs the tool unchanged and returns its result unchanged. It only counts the call. When Claude makes 6 tool calls without an update while steps are still open, it adds one short note to the result that only Claude reads. It also adds one note per request when Claude makes 4 tool calls with no list. Tool calls by subagents do not count. It never blocks a call.
- `command.run` for `steps` answers the mod's own `/steps` command. It shows or hides the pane and prints one line.
- `command.run` for `goal` runs Claude Code's own `/goal` unchanged and returns its result unchanged. It only reads the text after `/goal` to show it in the pane.
- `tool.call` for `ProposeGoal` runs the tool unchanged and returns its result unchanged. When the goal is set, it reads the goal's text to show it in the pane. A goal you turn down does not show.
- `tool.describe` for `mcp__steps__set_steps` sets `isDeferred` to false, so the tool's schema stays in the prompt and Claude does not have to look it up first. It changes nothing else, and no other tool.
- `prompt.compose` adds one section to the system prompt, `steps:rule`. The rule tells Claude when to make a list and how to keep it current. It keeps every other section as it is, and adds nothing to a bare session.
- `prompt.submit` starts the counts again for each new message. It passes the message on unchanged.
- `ui.render` for `SessionMode` adds the Steps button after the footer's own labels.
- `ui.render` for the `steps` pane draws the goal and the list.

## What it does not do

It makes no permission decisions. It makes no network calls, reads and writes no files, and sends nothing outside Claude Code. The list and the goal live only in the mod's memory for the session, and nothing is saved.

## Tests

```bash
claude plugin test .
```
