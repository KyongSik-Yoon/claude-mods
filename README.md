# claude-mods

Claude Code mods by KyongSik-Yoon.

## Install

```sh
claude plugin marketplace add KyongSik-Yoon/claude-mods
claude plugin install smooth-stream@kyongsik-mods
claude plugin install desktop-look@kyongsik-mods
```

Then run `/reload-plugins` in a running session, or start a new one. Requires a Claude Code build with mods support (tested on 2.1.289).

## Mods

| Mod | Description |
| --- | --- |
| [smooth-stream](./smooth-stream) | Reveal streaming assistant replies with a smooth typewriter effect (~30 fps, catches up on large bursts, speed configurable). |
| [desktop-look](./desktop-look) | Lay the terminal transcript out as the Claude Code mobile and desktop apps do: your prompts in a filled bubble on the right, each tool call as one line with a state mark and the command it ran (a click opens it), lists set in with bullets and hanging lines, the text between tool calls beside a grey bar, and an info band with this session's edits, cost and running tools. |

## Update

```sh
claude plugin marketplace update kyongsik-mods
claude plugin update smooth-stream@kyongsik-mods
claude plugin update desktop-look@kyongsik-mods
```
