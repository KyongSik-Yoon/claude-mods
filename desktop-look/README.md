# desktop-look

A Claude Code mod that makes the terminal transcript look more like the desktop app.

![Before and after, running and failed states](../docs/desktop-look.png)

- **Prompt bubbles**: your own messages sit on the right in a rounded bubble, wrapping at a share of the terminal width
- **Tool cards**: a tool call, its live progress and its result share one rail down the left edge, so they read as one card
- **State at a glance**: the rail is blue while a call runs, red when it errored, was refused at the dialog or was interrupted, and dim once done
- The engine still draws everything inside a card, so each tool's own summary and diff are unchanged
- Assistant replies are left alone, so it works alongside [smooth-stream](../smooth-stream)
- Terminal only; the desktop app, VS Code and mobile keep their own look

## Install

```sh
claude plugin marketplace add KyongSik-Yoon/claude-mods
claude plugin install desktop-look@kyongsik-mods
```

Then run `/reload-plugins` or start a new session. Requires a Claude Code build with mods support (tested on 2.1.289, fullscreen and light/dark themes).

## Options

Defaults to `75%`; no setup needed. To change it, run `/plugin configure desktop-look@kyongsik-mods` (or open `/config`) and set **Bubble width** to `60%`, `75%` or `90%`.

## How it works

- `UserMessage` (your own prompts only, not task notifications or other sessions' messages) is drawn as a right-aligned `Box` with a round border.
- `ToolUse`, `ToolGroup`, `ToolProgress` and `ToolResult` are separate render sites, so one border cannot span them. Each wraps the engine's own row (`await next(e)`) and adds an absolutely positioned one-column rail that stretches to the row's height, skipping the blank line the engine opens a tool row with.
- The rail colour comes from the row's props: `isRunning`, `isErrored`, `isInterrupted`, and the calls of a group.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
