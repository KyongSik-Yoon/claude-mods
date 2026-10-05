# smooth-stream

A Claude Code mod that reveals streaming assistant replies with a smooth typewriter effect, instead of dropping each chunk on screen at once.

- ~30 frames per second, at least a couple of characters per frame
- Catches up on large bursts within a fraction of a second, so it never falls far behind the model
- Only replies that arrive while the model is streaming are animated; old messages redrawn on resize or scroll show whole
- Works in the terminal and the desktop app's Code tab

## Install

```sh
claude plugin marketplace add KyongSik-Yoon/claude-mods
claude plugin install smooth-stream@kyongsik-mods
```

Then run `/reload-plugins` or start a new session. Requires a Claude Code build with mods support (tested on 2.1.289).

## Options

Open `/config` and set `smooth-stream` → **Reveal speed**:

| Value | Feel |
| --- | --- |
| `slow` | 1+ char per frame, drains a burst in ~0.8 s |
| `normal` (default) | 2+ chars per frame, drains a burst in ~0.4 s |
| `fast` | 4+ chars per frame, drains a burst in ~0.2 s |

## How it works

A `ui.render` hook on `AssistantMessage` hands the engine a prefix of the reply text, and a 33 ms `$.clock` timer grows that prefix through `$.state`, so each frame redraws only the message being typed. A `turn.step` hook tracks whether the main loop is streaming, which is how already-finished messages are left alone.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
