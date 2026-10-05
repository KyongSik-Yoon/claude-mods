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
| [desktop-look](./desktop-look) | Make the terminal transcript look like the desktop app: prompt bubbles on the right, tool calls and results as one card with a state-coloured rail. |

## Update

```sh
claude plugin marketplace update kyongsik-mods
claude plugin update smooth-stream@kyongsik-mods
claude plugin update desktop-look@kyongsik-mods
```
