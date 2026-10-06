# desktop-look

A Claude Code mod that lays the terminal transcript out as the Claude Code mobile app does.

![Default Claude Code, the mobile layout, and a line opened by a click](../docs/desktop-look.png)

- **Tool calls as one line**, as the mobile app lists them: `Ran <what the command is for> ›`, `Read register.tsx ›`, `Edited math.ts +1 -0 ›`. A Bash line also shows the head of the command it ran (`Ran Count lines $ wc -l math.ts ›`), so what ran is on screen and not only the model's description of it; a folded run lists each command. A thin mark opens each line in its state's colour: blue while the call runs or waits at the permission dialog (the label too), red when it failed (with `✗`) or was cut (`Interrupted ·`), green once it succeeded, as the stock transcript's dot turns. A run of reads and searches folds to one count line (`Read 2 files, ran 1 command ›`)
- **A click opens a line**: the engine's own row appears beneath it (the command, the diff, the output), and a second click folds it again. The todo list, the questions you answered and plans start open
- **The text between tool calls** sits beside a grey bar, so the narration of the work reads apart from the turn's opening line and its answer, which stay plain; the reply's `●` bullet is dropped
- **Prompt bubble**: your own messages sit in a bubble filled with the mobile app's grey (the theme's user-message colour, so it follows light and dark), on the right as the desktop and mobile apps set them; wrapping at a share of the terminal width
- **Info band** above the prompt: what this session edited (`✎ 2 files +7 -0`) and spent (`$0.05`) on the left, the tools running (`↻ Read ×3, Grep`, or `↻ 4 running` when narrow) on the right; hidden when there is nothing to show
- Works alongside [smooth-stream](../smooth-stream): the engine still draws the replies' markdown, so a mod that rewrites their text composes
- Terminal only; the desktop app, VS Code and mobile keep their own look. Clicks need fullscreen mode (`/config` → fullscreen); on the main screen tool calls keep the engine's rows

## Install

```sh
claude plugin marketplace add KyongSik-Yoon/claude-mods
claude plugin install desktop-look@kyongsik-mods
```

Then run `/reload-plugins` or start a new session. Requires a Claude Code build with mods support (tested on 2.1.290, fullscreen and light/dark themes).

## Options

No setup needed. To change one, run `/plugin configure desktop-look@kyongsik-mods` (or open `/config`):

| Option | Default | |
| --- | --- | --- |
| Bubble width | `75%` | How wide your own messages may grow: `60%`, `75%` or `90%` of the terminal |
| Info band | on | The band above the prompt |
| Band: model | off | Model and effort, for a status line that does not show them |
| Band: context | off | Context fill, for a status line that does not show it: blue while calm, the theme's warning amber from 300k tokens or 70%, its error red from 500k tokens or 90%, whichever comes first |

The cost is what Claude Code computes at API prices; on a subscription it is not what you are billed.

## How it works

- `ToolUse` and `ToolGroup` draw their own line from the call's props (`tool`, `input`, `isRunning`, `isErrored`, `isInterrupted`, `output`); the line is a plain `Button` whose press flips a `$.state` family member keyed by the row's `requestId` (its tool_use_id). Open, the row adds the engine's own drawing (`await next(e)`), and `ToolResult`, which shares that id, draws again. A group opens by passing `isExpanded: true` down; a group of one call opens that call's row instead.
- `AssistantMessage` passes `isFirstOfReply: false` down, which drops the bullet and keeps the engine's markdown. A text block is narration when, within its turn, a tool call came before it and another after it: read off each `turn.step`'s streamed blocks, and for a resumed session off `$.session.messages({ as: 'api' })`.
- The prompt bubble is a Box filled with `userMessageBackground`, pushed right by a growing spacer. The narration bar is a one-cell Box with a `subtle` background that the row's height stretches, and a tool line's mark is one glyph on its one row, so nothing can run past its row.
- The band is an `AbovePrompt` hook reading values in `$.state`, written by `tool.call` (tools running, and the `+`/`-` lines of each Edit and Write result's patch), `session.measure` (cost, context) and `turn.step` (model). A new session (`/clear`) starts the tally over; a reload keeps it.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
