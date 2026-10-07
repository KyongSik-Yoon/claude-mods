import { atom, memberOf, read, update } from 'claude-code'
import type { ClientElements, CoreEngineInterface, PromptOrigin, Register, RenderNode, StateDollar } from 'claude-code'

import type { Context, Edits, Model } from '../types'

// Origins whose text is the person's own prompt; everything else (task
// notifications, peers, channels) keeps the engine's row.
const OWN: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge'])

const WIDTHS = ['60%', '75%', '90%'] as const

// The theme's own blue, which reads in either: rgb(87,105,247) in light,
// rgb(177,185,249) in dark.
const CALM_COLOR = 'suggestion'


// The bar beside the person's prompt: a full cell in the theme's Claude
// orange, so it reads apart from a tool line's thin state mark and from the
// grey bar beside the text between tool calls.
const PROMPT_COLOR = 'claude'

// The mobile app's soft grey bar beside the text between tool calls; the
// theme's own shade, so it reads in light and dark.
const NARRATION_COLOR = 'subtle'

// Tools whose row is the point (the plan, the todo list, the answers given):
// they start open, and a press folds them.
const OPEN_BY_DEFAULT: ReadonlySet<string> = new Set(['TodoWrite', 'AskUserQuestion', 'ExitPlanMode'])

// A tool line opens with a thin mark in its state's colour: blue while it
// runs, red when it failed or was cut, green once it succeeded, as the stock
// transcript's dot turns. A quarter cell, so it reads apart from the
// narration's bar.
type Tone = 'running' | 'failed' | 'done'
const TONES = { running: { color: 'blue' }, failed: { color: 'red' }, done: { color: 'green' } } as const
const STATE_MARK = '▎ '
// The blank row above a line that sits right under another call's: the mark
// runs through it in this line's colour, so a run of calls reads as one line.
const JOIN_MARK = '▎'

const MODEL = atom({ plugin: 'desktop-look', key: 'model' } as const, null)
const CONTEXT = atom({ plugin: 'desktop-look', key: 'context' } as const, null)
const TOOLS = atom({ plugin: 'desktop-look', key: 'tools' } as const, [] as string[])
const EDITS = atom({ plugin: 'desktop-look', key: 'edits' } as const, null)
const COST = atom({ plugin: 'desktop-look', key: 'cost' } as const, null)
const NARRATION = atom({ plugin: 'desktop-look', key: 'narration' } as const, [] as string[])
const JOINED = atom({ plugin: 'desktop-look', key: 'joined' } as const, [] as string[])
const AFTER_CALL = atom({ plugin: 'desktop-look', key: 'afterCall' } as const, false)
const OPEN = atom({ plugin: 'desktop-look', key: 'open' } as const, false)

// Enough for a long session's worth of steps; older ones have scrolled away.
const NARRATION_KEPT = 300
const JOINED_KEPT = 1000

type Patch = { lines: string[] }

// The lines an Edit or Write result added and removed, from its patch; a new
// file's patch is empty, so its content counts as added.
export const diffStat = (tool: string, result: unknown): { file: string; added: number; removed: number } | null => {
  if (tool !== 'Edit' && tool !== 'Write') return null
  const r = result as { filePath?: string; structuredPatch?: Patch[]; type?: string; content?: string }
  if (typeof r?.filePath !== 'string') return null
  let added = 0
  let removed = 0
  for (const hunk of r.structuredPatch ?? []) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  if (r.type === 'create' && added === 0 && typeof r.content === 'string' && r.content !== '') {
    added = r.content.replace(/\n$/, '').split('\n').length
  }
  return { file: r.filePath, added, removed }
}

// `mcp__slack__send_message` reads as `send_message`; built-in names as given.
export const toolLabel = (tool: string): string => tool.split('__').pop() || tool

// The tools running, in the order they started, each once with its count:
// `Read ×3, Grep`. Wider than `room`, it falls back to `4 running`.
export const runningLabel = (tools: readonly string[], room: number): string => {
  const counts = new Map<string, number>()
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1)
  const named = [...counts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')
  return named.length <= room ? named : `${tools.length} running`
}

export const dollars = (usd: number): string => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

// `claude-opus-5-5[1m]` reads as `Opus 5.5 · 1M`, `claude-haiku-4-5-20251001`
// as `Haiku 4.5`; an id it does not know is shown as given.
export const modelLabel = (id: string): string => {
  const m = /(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d{1,2})(?!\d))?)?/i.exec(id)
  if (!m?.[1]) return id
  const family = m[1][0]!.toUpperCase() + m[1].slice(1).toLowerCase()
  const version = m[2] ? ` ${m[2]}${m[3] ? `.${m[3]}` : ''}` : ''
  return `${family}${version}${/\[1m\]/i.test(id) ? ' · 1M' : ''}`
}

// How full the context is, by whichever bites first: the tokens held (a long
// context dulls the model well before a 1M window fills), or the window's
// share (a 200k window nears compaction).
export const pressure = (context: Context): 'calm' | 'warn' | 'alert' => {
  const tokens = context.tokens ?? 0
  const percent = context.percent ?? 0
  if (tokens >= 500_000 || percent >= 90) return 'alert'
  if (tokens >= 300_000 || percent >= 70) return 'warn'
  return 'calm'
}

// Calm in the theme's blue; then the theme's warning and
// error colours, which a light theme darkens (a named yellow glares there).
const SHADES = { calm: { color: CALM_COLOR }, warn: { color: 'warning' }, alert: { color: 'error' } } as const

const short = (n: number): string =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`

// Ten cells, as the desktop app's context ring reads at a glance: the filled
// run and the empty one. Box-drawing glyphs, which every terminal draws one
// cell wide.
export const fill = (percent: number): [string, string] => {
  const cells = Math.min(10, Math.max(0, Math.round(percent / 10)))
  return ['━'.repeat(cells), '─'.repeat(10 - cells)]
}

// The model's text that sits between two tool calls of one turn: what the
// mobile app draws beside a grey bar. The turn's opening line and its answer
// stay plain. `pieces` are one turn's, or one step's, in order: a text block,
// or null for a tool call; `toolBefore` when a call came earlier in the turn.
export const between = (pieces: readonly (string | null)[], toolBefore = false): string[] => {
  const last = pieces.lastIndexOf(null)
  let before = toolBefore
  const found: string[] = []
  pieces.forEach((piece, at) => {
    if (piece === null) before = true
    else if (before && at < last && piece.trim()) found.push(piece.trim())
  })
  return found
}

// The calls of one turn whose line sits right under another call's: a call
// with no text since the last one. `pieces` are a text, or a call's id;
// `before` whether the turn's last block so far was a call. Answers the ids
// and whether the last block here is a call.
export const joinedCalls = (pieces: readonly (string | { id: string })[], before = false): [string[], boolean] => {
  const found: string[] = []
  let after = before
  for (const piece of pieces) {
    if (typeof piece === 'string') {
      if (piece.trim()) after = false
    } else {
      if (after) found.push(piece.id)
      after = true
    }
  }
  return [found, after]
}

type Block = { readonly type: string; readonly [field: string]: unknown }

// The same, read off a transcript in Messages API form, turn by turn.
export const joinedIn = (messages: readonly { role: 'user' | 'assistant'; content: readonly Block[] }[]): string[] => {
  const found: string[] = []
  let after = false
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.content.some(b => b.type === 'tool_result')) after = false
      continue
    }
    const pieces = m.content.flatMap((b): (string | { id: string })[] =>
      b.type === 'tool_use' && typeof b.id === 'string' ? [{ id: b.id }] : b.type === 'text' && typeof b.text === 'string' ? [b.text] : [],
    )
    const [ids, last] = joinedCalls(pieces, after)
    found.push(...ids)
    after = last
  }
  return found.slice(-JOINED_KEPT)
}

// The same, read off a transcript in Messages API form (blocks intact), turn
// by turn: a person's prompt opens one; tool results carry it on.
export const narrations = (messages: readonly { role: 'user' | 'assistant'; content: readonly Block[] }[]): string[] => {
  const found: string[] = []
  let turn: (string | null)[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.content.some(b => b.type === 'tool_result')) {
        found.push(...between(turn))
        turn = []
      }
      continue
    }
    for (const b of m.content) {
      if (b.type === 'tool_use') turn.push(null)
      else if (b.type === 'text' && typeof b.text === 'string') turn.push(b.text)
    }
  }
  found.push(...between(turn))
  return found.slice(-NARRATION_KEPT)
}

// What a call did, as the mobile app's one line says it: `Ran <what the
// command is for>`, `Read register.tsx`; a running call in the present tense.
const VERBS: Readonly<Record<string, readonly [running: string, done: string]>> = {
  Bash: ['Running', 'Ran'],
  Read: ['Reading', 'Read'],
  Edit: ['Editing', 'Edited'],
  MultiEdit: ['Editing', 'Edited'],
  NotebookEdit: ['Editing', 'Edited'],
  Write: ['Writing', 'Wrote'],
  Grep: ['Searching for', 'Searched for'],
  Glob: ['Finding', 'Found'],
  WebFetch: ['Fetching', 'Fetched'],
  WebSearch: ['Searching the web for', 'Searched the web for'],
  Agent: ['Running agent', 'Ran agent'],
  Task: ['Running agent', 'Ran agent'],
  Skill: ['Loading skill', 'Loaded skill'],
  TodoWrite: ['Updating todos', 'Updated todos'],
}

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

// The call's object: a command's description, a file's name, a pattern.
const subject = (tool: string, input: unknown): string => {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const arg = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
  switch (tool) {
    case 'Bash':
      return arg('description') || (arg('command').split('\n')[0] ?? '')
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return basename(arg('file_path'))
    case 'NotebookEdit':
      return basename(arg('notebook_path'))
    case 'Grep':
    case 'Glob':
      return arg('pattern')
    case 'WebFetch':
      return /^[a-z]+:\/\/([^/?#]+)/i.exec(arg('url'))?.[1] ?? arg('url')
    case 'WebSearch':
      return arg('query')
    case 'Skill':
      return arg('skill')
    case 'TodoWrite':
      return ''
    default:
      return arg('description')
  }
}

export const callLabel = (tool: string, input: unknown, running: boolean): string => {
  const verbs = VERBS[tool]
  const head = verbs ? verbs[running ? 0 : 1] : toolLabel(tool)
  const what = subject(tool, input).trim()
  return what ? `${head} ${what}` : head
}

// A folded run of calls, counted as the engine's own line counts them:
// `Read 2 files, ran 1 command`, in the order the kinds first came.
const KINDS: Readonly<Record<string, readonly [running: string, done: string, one: string, many: string]>> = {
  Read: ['reading', 'read', 'file', 'files'],
  Bash: ['running', 'ran', 'command', 'commands'],
  Grep: ['searching', 'searched', 'pattern', 'patterns'],
  Glob: ['searching', 'searched', 'pattern', 'patterns'],
}

export const groupLabel = (calls: readonly { tool: string; input: unknown; isRunning: boolean }[]): string => {
  const running = calls.some(c => c.isRunning)
  // One call reads as the call itself: `Ran <what for>`, not `Ran 1 command`.
  if (calls.length === 1) return callLabel(calls[0]!.tool, calls[0]!.input, running)
  const counts = new Map<string, { n: number; tool: string }>()
  for (const c of calls) {
    const kind = KINDS[c.tool] ? KINDS[c.tool]![1] : c.tool
    const seen = counts.get(kind)
    counts.set(kind, { n: (seen?.n ?? 0) + 1, tool: seen?.tool ?? c.tool })
  }
  const said = [...counts.values()]
    .map(({ n, tool }) => {
      const kind = KINDS[tool]
      if (!kind) return n > 1 ? `${toolLabel(tool)} ×${n}` : toolLabel(tool)
      return `${kind[running ? 0 : 1]} ${n} ${n === 1 ? kind[2] : kind[3]}`
    })
    .join(', ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

// Cells a string takes: two for Hangul, CJK and full-width forms, one otherwise.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const cells = (s: string): number => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0)

// One row's worth: cut to `room` cells with an ellipsis.
export const clip = (s: string, room: number): string => {
  if (cells(s) <= room) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = WIDE.test(ch) ? 2 : 1
    if (used + w > room - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

// A reply cut where its lists are: the lists this mod draws, as the apps do
// (a bullet, an indent, the wrapped lines hung under the text), and the rest
// as the engine's markdown. `gap` when a blank line came before the piece.
export type Piece =
  | { kind: 'text'; text: string; gap: boolean }
  | { kind: 'list'; marker: string; start: number; loose: boolean; items: Piece[][]; tasks: (boolean | null)[]; gap: boolean }
  | { kind: 'quote'; pieces: Piece[]; gap: boolean }
  | { kind: 'rule'; gap: boolean }

type Item = { marker: string; start: number; col: number; empty: boolean }
type Fence = { mark: string; length: number } | null

const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)(.*)$/
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/
const HEADING = /^ {0,3}#{1,6}(?: |$)/
const QUOTE = /^ {0,3}>/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
// A task item's box, `[ ]` or `[x]`, and the text after it.
const TASK = /^\[([ xX])\] +(\S.*)$/

// A list item's first line, as CommonMark reads it: its marker and the column
// its text starts at (past one to four spaces; five or more begin indented code).
const itemAt = (line: string): Item | null => {
  const m = ITEM.exec(line)
  if (!m || RULE.test(line)) return null
  const [, indent = '', marker = '', spaces = '', rest = ''] = m
  const pad = !rest || spaces.length > 4 ? 1 : spaces.length
  const start = /\d/.test(marker) ? parseInt(marker, 10) : 1
  return { marker: /\d/.test(marker) ? marker.slice(-1) : marker, start, col: indent.length + marker.length + pad, empty: !rest.trim() }
}

const indentOf = (line: string): number => line.length - line.trimStart().length

// A numbered item's marker is its delimiter, `.` or `)`; a bullet's, its char.
const numbered = (marker: string): boolean => marker === '.' || marker === ')'

// The fence open after `line`: opened, closed by a run as long, or as it was.
const fenceAfter = (fence: Fence, line: string): Fence => {
  const run = FENCE.exec(line)?.[1] ?? ''
  if (!fence) return run ? { mark: run.charAt(0), length: run.length } : null
  return run.charAt(0) === fence.mark && run.length >= fence.length && !line.trim().slice(run.length).trim() ? null : fence
}

const isParagraph = (line: string): boolean => !!line.trim() && !HEADING.test(line) && !RULE.test(line)

type List = Piece & { kind: 'list' }

// One list from `at`, opened by `head`: its items while siblings follow, each
// item's lines those indented to its text, plus lazy lines carrying on its
// paragraph. Blank lines after the last item stay the caller's.
const listAt = (lines: readonly string[], at: number, head: Item): [List, number] => {
  const list: List = { kind: 'list', marker: head.marker, start: head.start, loose: false, items: [], tasks: [], gap: false }
  let i = at
  for (let item = head; ; ) {
    let last = (lines[i] ?? '').slice(item.col)
    const task = TASK.exec(last)
    list.tasks.push(task ? task[1] !== ' ' : null)
    if (task) last = task[2] ?? ''
    const body = [last]
    let fence = fenceAfter(null, last)
    for (i++; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (!line.trim() || indentOf(line) >= item.col) last = line.slice(Math.min(item.col, indentOf(line)))
      else if (!fence && isParagraph(last) && isParagraph(line) && !QUOTE.test(line) && !FENCE.test(line) && !itemAt(line))
        last = line.trimStart()
      else break
      body.push(last)
      fence = fenceAfter(fence, last)
    }
    let blank = 0
    while (body.length - blank > 1 && !body[body.length - 1 - blank]?.trim()) blank++
    list.items.push(cut(body.slice(0, body.length - blank)))
    const next = i < lines.length ? itemAt(lines[i] ?? '') : null
    if (!next || next.marker !== head.marker) return [list, i - blank]
    list.loose ||= blank > 0
    item = next
  }
}

type Quote = Piece & { kind: 'quote' }

// One block quote from `at`: its `>` lines, and lazy lines carrying on its
// paragraph; its own lines, markers off, cut into pieces as any text is.
const quoteAt = (lines: readonly string[], at: number): [Quote, number] => {
  const inner: string[] = []
  let i = at
  let fence: Fence = null
  for (; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const last = inner[inner.length - 1] ?? ''
    if (QUOTE.test(line)) inner.push(line.replace(/^ {0,3}> ?/, ''))
    else if (!fence && isParagraph(last) && isParagraph(line) && !FENCE.test(line) && !itemAt(line)) inner.push(line.trimStart())
    else break
    fence = fenceAfter(fence, inner[inner.length - 1] ?? '')
  }
  return [{ kind: 'quote', pieces: cut(inner), gap: false }, i]
}

// Lines into pieces. A list may break into a paragraph only as CommonMark
// lets it: with text in its first item and, numbered, starting at 1.
export const cut = (lines: readonly string[]): Piece[] => {
  const pieces: Piece[] = []
  let text: string[] = []
  let gap = false
  const flush = () => {
    const a = text.findIndex(line => line.trim())
    if (a < 0) gap ||= text.length > 0
    else {
      let b = text.length
      while (!text[b - 1]?.trim()) b--
      pieces.push({ kind: 'text', text: text.slice(a, b).join('\n'), gap: gap || a > 0 })
      gap = b < text.length
    }
    text = []
  }
  let fence: Fence = null
  let paragraph = false
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? ''
    // A quote holding something drawn here is a piece of its own; one that
    // holds only text stays in the text, as the engine draws it.
    if (!fence && QUOTE.test(line)) {
      const [quote, next] = quoteAt(lines, i)
      if (quote.pieces.some(p => p.kind !== 'text')) {
        flush()
        pieces.push({ ...quote, gap })
        gap = false
        paragraph = false
        i = next
        continue
      }
    }
    // A rule, which the engine draws as its dashes; `---` under a paragraph
    // underlines a heading instead.
    if (!fence && RULE.test(line) && !(paragraph && line.trim().startsWith('-'))) {
      flush()
      pieces.push({ kind: 'rule', gap })
      gap = false
      paragraph = false
      i++
      continue
    }
    const item = fence ? null : itemAt(line)
    if (item && (!paragraph || (!item.empty && (!numbered(item.marker) || item.start === 1)))) {
      flush()
      const [list, next] = listAt(lines, i, item)
      pieces.push({ ...list, gap })
      gap = false
      paragraph = false
      i = next
      continue
    }
    const was = fence
    fence = fenceAfter(fence, line)
    paragraph = !was && !fence && isParagraph(line)
    text.push(line)
    i++
  }
  flush()
  return pieces
}

// The pieces of a reply worth drawing here: null when it has no list, rule
// or quote holding one, or holds what only the engine's own drawing hides or
// can take.
export const listed = (text: string): Piece[] | null => {
  if (text.length > 50_000 || text.includes('<context>')) return null
  const pieces = cut(text.split('\n'))
  return pieces.some(p => p.kind !== 'text') ? pieces : null
}

const BULLETS = '•◦▪'
// A task's box, open or ticked, as the apps draw it.
const BOXES = { open: '☐', done: '☑' } as const

// Each item's mark: its number, as the list counts from its start, or the
// bullet for its depth; a task's box in place of its bullet, or after its
// number; numbers right-aligned to the widest.
export const marks = (list: List, depth: number): string[] => {
  const said = list.items.map((_, i) => {
    const task = list.tasks[i]
    const box = task === undefined || task === null ? null : task ? BOXES.done : BOXES.open
    if (numbered(list.marker)) return `${list.start + i}${list.marker}${box ? ` ${box}` : ''}`
    return box ?? BULLETS.charAt(Math.min(depth, BULLETS.length - 1))
  })
  const wide = Math.max(...said.map(m => m.length))
  return said.map(m => `${m.padStart(wide)} `)
}

// CommonMark leaves a `**` as written when it closes right after a quote, a
// bracket or a `?` and runs into a letter, which Korean particles do all the
// time (`**"인용"**을`), or opens in the mirror of that. A zero-width space
// on that side lets the run open or close, and the screen drops it, so text
// copied off it is as written; code is left as written.
const JOINER = '\u200B'
const PUNCTUATION = /[\p{P}\p{S}]/u
const side = (ch: string | undefined): 'space' | 'mark' | 'letter' =>
  ch === undefined || /\s/u.test(ch) ? 'space' : PUNCTUATION.test(ch) ? 'mark' : 'letter'

const mendLine = (line: string): string => {
  const chars = [...line]
  let out = ''
  for (let i = 0; i < chars.length; ) {
    const ch = chars[i] ?? ''
    let n = 0
    while (chars[i + n] === ch) n++
    if (ch === '\\') n = Math.min(2, chars.length - i)
    else if (ch === '`') {
      // A code span ends at the next run of as many backticks.
      for (let j = i + n; j < chars.length; ) {
        let m = 0
        while (chars[j + m] === '`') m++
        if (m === n) {
          n = j + m - i
          break
        }
        j += m || 1
      }
    } else if (ch === '*' && n >= 2) {
      const [before, after] = [side(chars[i - 1]), side(chars[i + n])]
      const run = '*'.repeat(n)
      out += before === 'mark' && after === 'letter' ? JOINER + run : after === 'mark' && before === 'letter' ? run + JOINER : run
      i += n
      continue
    }
    out += chars.slice(i, i + n).join('')
    i += n
  }
  return out
}

// The text as the engine should read it: bold that CommonMark would leave as
// asterisks mended, fences left alone; the same string when nothing needs it.
export const mended = (text: string): string => {
  let fence: Fence = null
  const lines = text.split('\n').map(line => {
    const was = fence
    fence = fenceAfter(fence, line)
    return was || fence || !line.includes('**') ? line : mendLine(line)
  })
  const out = lines.join('\n')
  return out === text ? text : out
}

// `git diff --numstat` read as one stat: a binary file (`-`) counts as a file
// with no lines.
export const numstat = (out: string): Edits => {
  const rows = out.split('\n').filter(row => row.includes('\t'))
  const count = (n: string | undefined) => (n === undefined || n === '-' ? 0 : Number(n) || 0)
  return rows.reduce<Edits>(
    (sum, row) => {
      const [added, removed] = row.split('\t')
      return { files: sum.files + 1, added: sum.added + count(added), removed: sum.removed + count(removed) }
    },
    { files: 0, added: 0, removed: 0 },
  )
}

// A text file's lines as git counts them added; null for a binary one.
export const linesOf = (text: string): number | null =>
  text.includes('\0') ? null : text === '' ? 0 : text.replace(/\n$/, '').split('\n').length

// What counting the working copy needs of `$`.
type Git = Pick<CoreEngineInterface, 'process' | 'fs'>

// Git's empty tree, what a repository with no commit yet diffs against.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
// Past this many new files, the rest count as files without their lines.
const UNTRACKED_READ = 200

// The working copy's changes not yet committed, as the reviewer and the
// desktop app's diff count them: tracked files against HEAD, staged or not,
// and each new file not ignored, all its lines added. Null outside a repository.
const uncommitted = async ($: Git): Promise<Edits | null> => {
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return null
  // From the top, so a session in a subfolder counts the whole repository.
  const root = top.stdout.trim()
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd: root })
  let diff = await git('diff', 'HEAD', '--numstat')
  if (diff.exitCode !== 0) diff = await git('diff', EMPTY_TREE, '--numstat')
  if (diff.exitCode !== 0) return null
  const stat = numstat(diff.stdout)
  const others = await git('ls-files', '--others', '--exclude-standard', '-z')
  const fresh = others.exitCode === 0 ? others.stdout.split('\0').filter(Boolean) : []
  let added = 0
  for (const file of fresh.slice(0, UNTRACKED_READ)) {
    try {
      added += linesOf(await $.fs.read(`${root}/${file}`)) ?? 0
    } catch {
      // Over the read limit or gone since: a file without its lines.
    }
  }
  return { files: stat.files + fresh.length, added: stat.added + added, removed: stat.removed }
}

// One count of the working copy at a time; a call while one runs counts
// again once it is done, so the last change is in the figure.
let counting: Promise<void> | null = null
let stale = false
const recount = ($: Git & StateDollar): Promise<void> => {
  if (counting) {
    stale = true
    return counting
  }
  counting = (async () => {
    do {
      stale = false
      const edits = await uncommitted($).catch(() => null)
      await update($, EDITS, () => edits)
    } while (stale)
  })().finally(() => {
    counting = null
  })
  return counting
}

// Whether a call's line runs its mark up into the row above: the call came
// right after another, with no text between.
const joinsAbove = async ($: StateDollar, id: string): Promise<boolean> => (await read($, JOINED)).includes(id)

// Tools that may change the working copy: an edit, or a command (a commit, a
// checkout, a script).
const CHANGES_FILES: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash'])

// The lists of an approved plan's text, when it has any.
export const planPieces = (output: unknown): Piece[] | null => {
  if (typeof output !== 'object' || output === null || !('plan' in output)) return null
  return typeof output.plan === 'string' ? listed(mended(output.plan)) : null
}

// Taller and wider than any reply's quote or rule; the box around clips them.
const QUOTE_BAR = Array.from({ length: 1000 }, () => '▎').join('\n')
const RULE_LINE = '─'.repeat(500)

// Text with lists, drawn: each item a row, its mark, then its text in a
// column, so wrapped lines hang under the text; a list at the left edge set
// in by two. The rest goes to the engine's Markdown, styling and all.
const setIn = (ui: Pick<ClientElements, 'Box' | 'Text' | 'Markdown'>, pieces: readonly Piece[]): RenderNode[] => {
  const { Box, Text, Markdown } = ui
  const draw = (pieces: readonly Piece[], depth: number): RenderNode[] =>
    pieces.map((piece, at) => (
      <Box flexDirection="column" marginTop={at > 0 && piece.gap ? 1 : 0}>
        {piece.kind === 'text'
          ? <Markdown text={piece.text} />
          : piece.kind === 'list'
            ? drawList(piece, depth)
            : piece.kind === 'quote'
              ? drawQuote(piece, depth)
              : drawRule()}
      </Box>
    ))
  // The engine's dim bar down the quote's left, as tall as what it holds.
  const drawQuote = (quote: Quote, depth: number): RenderNode => (
    <Box flexDirection="column" paddingLeft={2} position="relative">
      <Box position="absolute" top={0} left={0} width={1} height="100%" overflow="hidden">
        <Text dimColor>{QUOTE_BAR}</Text>
      </Box>
      {draw(quote.pieces, depth)}
    </Box>
  )
  // A dim line across the width, where the engine leaves the dashes.
  const drawRule = (): RenderNode => (
    <Box height={1} overflow="hidden">
      <Text dimColor>{RULE_LINE}</Text>
    </Box>
  )
  const drawList = (list: List, depth: number): RenderNode => {
    const shown = marks(list, depth)
    return (
      <Box flexDirection="column" paddingLeft={depth === 0 ? 2 : 0}>
        {list.items.map((item, i) => (
          <Box flexDirection="row" marginTop={i > 0 && list.loose ? 1 : 0}>
            <Box flexShrink={0}>
              <Text>{shown[i]}</Text>
            </Box>
            <Box flexDirection="column" flexShrink={1} flexGrow={1}>
              {draw(item, depth + 1)}
            </Box>
          </Box>
        ))}
      </Box>
    )
  }
  return draw(pieces, 0)
}

// Pasted text reaches the hook in the engine's framing for the model: each
// block as `\n\n<pasted_content id="…">\n` + what was pasted +
// `\n</pasted_content id="…">\n`, in place of the composer's placeholder. Each
// folds back to that placeholder, the framing's newlines with it, counted as
// the engine counts (the pasted text's line breaks). The placeholder's number
// runs across the session and the hook is not told it, so it is left out.
const PASTED = /(?:\n\n)?<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">\n?/g

// A prompt cut where its pasted blocks are; each block with the line breaks
// the engine counts (it drops a paste's last one before framing, so a paste
// that ended in one reads one short of the composer's).
export type Said = { kind: 'text'; text: string } | { kind: 'paste'; body: string; lines: number }

export const said = (text: string): Said[] => {
  const out: Said[] = []
  let at = 0
  for (const m of text.matchAll(PASTED)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) })
    const body = m[2] ?? ''
    out.push({ kind: 'paste', body, lines: body.split('\n').length - 1 })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

export const placeholder = (lines: number): string => `[Pasted text +${lines} lines]`

export const folded = (text: string): string =>
  said(text)
    .map(piece => (piece.kind === 'text' ? piece.text : placeholder(piece.lines)))
    .join('')

export const register: Register = (on, options) => {
  const width = WIDTHS.find(w => w === options.bubbleWidth) ?? '75%'
  const spacer = `${100 - parseInt(width, 10)}%`
  const showBand = options.showBand !== false
  const bandModel = options.bandModel === true
  const bandContext = options.bandContext === true
  const showPrompt = options.showPrompt !== false
  const showReplies = options.showReplies !== false
  const showTools = options.showTools !== false

  // The band's figures: seeded when the session starts, then pushed by the
  // engine (each main-loop step, each measurement, each tool call); the
  // working copy's changes counted again after each step and each call that
  // may change it.
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const [id, usage, messages] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      $.session.messages({ as: 'api' }),
    ])
    await update($, MODEL, model => model ?? { id })
    await update($, CONTEXT, () => usage.context)
    await update($, COST, () => usage.cost?.usd ?? null)
    await update($, TOOLS, () => [])
    // A resumed transcript's text between tool calls, read off the messages.
    await update($, NARRATION, () => narrations(messages))
    await update($, JOINED, () => joinedIn(messages))
    void recount($)
    return started
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const model: Model = e.effort === undefined ? { id: e.model } : { id: e.model, effort: String(e.effort) }
    await update($, MODEL, () => model)
    // The response's blocks as they stream: each text, and where calls sit.
    const blocks = new Map<number, string | null>()
    const ids = new Map<number, string>()
    const stream = next(e)
    let item = await stream.next()
    while (!item.done) {
      const chunk = item.value
      if (chunk.kind === 'text') blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
      else if (chunk.kind === 'tool') {
        blocks.set(chunk.index, null)
        ids.set(chunk.index, chunk.id)
      }
      yield chunk
      item = await stream.next()
    }
    const step = item.value
    const streamed = [...blocks].sort(([a], [b]) => a - b).map(([, piece]) => piece)
    // A response a hook beneath answered whole streams no text: read it off
    // the result, its text before its calls.
    const pieces =
      streamed.some(p => p !== null) || !step.answer.trim() ? streamed : [step.answer, ...step.toolUses.map(() => null)]
    const said = between(pieces, e.index > 0)
    if (said.length > 0) await update($, NARRATION, kept => [...kept, ...said].slice(-NARRATION_KEPT))
    // Calls right under a call: a new turn starts after the person's prompt.
    const order = [...blocks].sort(([a], [b]) => a - b).map(([at, piece]) => piece ?? { id: ids.get(at) ?? '' })
    const [joined, after] = joinedCalls(order, e.index > 0 && (await read($, AFTER_CALL)))
    await update($, AFTER_CALL, () => after)
    if (joined.length > 0) await update($, JOINED, kept => [...kept, ...joined].slice(-JOINED_KEPT))
    // What the person changed or committed in the meantime.
    void recount($)
    return step
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const { tokens, window, percent } = e.context
      const context: Context = { window, ...(tokens === undefined ? {} : { tokens }), ...(percent === undefined ? {} : { percent }) }
      await update($, CONTEXT, () => context)
    }
    if (e.changed.includes('cost') && e.cost) {
      const usd = e.cost.usd
      await update($, COST, () => usd)
    }
    return next(e)
  })

  // No response reports the context a compaction left until the next one is
  // answered: count it now, so the band drops when the conversation does.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || !done.messages) return done
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const tokens = context.breakdown?.totalTokens ?? done.tokensAfter
    if (tokens !== undefined) {
      const percent = Math.min(100, Math.round((tokens / context.window) * 100))
      await update($, CONTEXT, () => ({ window: context.window, tokens, percent }))
    }
    return done
  })

  on('tool.call', async ($, e, next) => {
    const label = toolLabel(e.tool)
    await update($, TOOLS, tools => [...tools, label])
    try {
      const done = await next(e)
      if (CHANGES_FILES.has(e.tool)) void recount($)
      return done
    } finally {
      await update($, TOOLS, tools => {
        const at = tools.indexOf(label)
        return at < 0 ? tools : [...tools.slice(0, at), ...tools.slice(at + 1)]
      })
    }
  })

  // One row above the prompt, as the desktop app's composer bar: on the left
  // what this session edited and spent, on the right the tools running; the
  // model and the context fill when turned on.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !showBand || e.props.hasSurvey) return next(e)
    const [stored, measured, tools, edits, cost] = await Promise.all([
      read($, MODEL),
      read($, CONTEXT),
      read($, TOOLS),
      read($, EDITS),
      read($, COST),
    ])
    const model = bandModel ? stored : null
    const context = bandContext ? measured : null
    const edited = edits && edits.files > 0 ? edits : null
    const spent = cost !== null && cost > 0 ? cost : null
    if (!model && context?.percent === undefined && tools.length === 0 && !edited && spent === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    // The left: what the working copy holds uncommitted and the session spent, then the model when on.
    const left: RenderNode[] = []
    if (edited) {
      left.push(
        <Text>
          <Text dimColor>
            {String(edited.files)} {edited.files === 1 ? 'file' : 'files'}{' '}
          </Text>
          <Text color="green">+{String(edited.added)}</Text>
          <Text dimColor> </Text>
          <Text color="red">-{String(edited.removed)}</Text>
        </Text>,
      )
    }
    if (spent !== null) left.push(<Text dimColor>{dollars(spent)}</Text>)
    if (model) left.push(<Text dimColor>◆ {modelLabel(model.id)}{model.effort ? ` · ${model.effort}` : ''}</Text>)

    const right: RenderNode[] = []
    if (tools.length > 0) {
      // What the left half and the gaps leave; the context fill takes its own.
      const used =
        (edited ? `${edited.files} files +${edited.added} -${edited.removed}`.length + 2 : 0) +
        (spent !== null ? dollars(spent).length + 2 : 0) +
        (model ? modelLabel(model.id).length + (model.effort?.length ?? 0) + 7 : 0) +
        (context?.percent !== undefined ? 30 : 0)
      const room = Math.max(0, e.props.bodyColumns - used - 4)
      right.push(<Text color="blue">↻ {runningLabel(tools, room)}</Text>)
    }
    if (context?.percent !== undefined) {
      const shade = SHADES[pressure(context)]
      const [filled, empty] = fill(context.percent)
      right.push(
        <Text>
          <Text {...shade}>{filled}</Text>
          <Text dimColor>{empty}</Text>
          <Text {...shade}>
            {' '}
            {String(context.percent)}%
            {context.tokens === undefined ? '' : ` · ${short(context.tokens)}/${short(context.window)}`}
          </Text>
        </Text>,
      )
    }

    return (
      <Box flexDirection="column">
        <Box width={e.props.bodyColumns} justifyContent="space-between">
          <Box gap={2}>{...left}</Box>
          <Box gap={2}>{...right}</Box>
        </Box>
        {await next(e)}
      </Box>
    )
  })

  // The person's prompt at the left edge beside an orange bar, where the
  // engine's row for a pasted image (`⎿ [Image #1]`), which no hook reaches,
  // sits under it; at most `width` of the terminal wide. Pasted text reads as
  // the composer's placeholder, which a press opens.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !showPrompt || !OWN.has(e.props.origin.kind) || e.props.from || e.props.task) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const pieces = said(e.props.text)
    // A pasted block is its placeholder, a press away from what was pasted:
    // each its own row, the text around it on rows of its own.
    const rows: RenderNode[] = []
    for (const [i, piece] of pieces.entries()) {
      if (piece.kind === 'text') {
        const text = piece.text.replace(/^\n/, '').replace(/\s+$/, '')
        if (text) rows.push(<Text wrap="wrap">{text}</Text>)
        continue
      }
      const member = memberOf(OPEN, { requestId: `${e.requestId}:paste:${i}` })
      const open = e.props.isExpanded || (await read($, member))
      const toggle = () => void update($, member, v => !v)
      rows.push(
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Button plain dimColor key={`paste-${i}`} label={placeholder(piece.lines)} onPress={toggle} />
            <Text> </Text>
            <Button plain dimColor key={`mark-${i}`} label={open ? '⌄' : '›'} onPress={toggle} />
          </Box>
          {open ? <Text wrap="wrap">{piece.body}</Text> : null}
        </Box>,
      )
    }
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box flexShrink={1} flexDirection="row">
          <Box width={1} flexShrink={0} backgroundColor={PROMPT_COLOR} />
          <Box flexShrink={1} flexDirection="column" paddingLeft={1}>
            {...rows}
          </Box>
        </Box>
        <Box flexGrow={1} minWidth={spacer} />
      </Box>
    )
  })

  // The reply's text without the bullet, flush left as the mobile app sets it;
  // the text between two tool calls beside a grey bar. A reply with a list is
  // drawn here, its lists set in with bullets and its prose by the Markdown
  // element; any other reply is the engine's, so a mod beneath that rewrites
  // the text composes with this.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !showReplies) return next(e)
    const plain = { ...e, props: { ...e.props, text: mended(e.props.text), isFirstOfReply: false } }
    if (e.props.isSummary) return next(plain)
    const { Box } = $.ui.resolve(e)
    // Opens with a blank row as the engine's drawing does.
    const pieces = listed(plain.props.text)
    const reply = pieces ? (
      <Box flexDirection="column" marginTop={1}>
        {setIn($.ui.resolve(e), pieces)}
      </Box>
    ) : (
      await next(plain)
    )
    if (!(await read($, NARRATION)).includes(e.props.text.trim())) return reply
    // The bar skips that blank row.
    return (
      <Box flexDirection="row">
        <Box width={1} flexShrink={0} marginTop={1} backgroundColor={NARRATION_COLOR} />
        <Box flexShrink={1} flexGrow={1} paddingLeft={1}>
          {reply}
        </Box>
      </Box>
    )
  })

  // A tool call as one dim line, as the mobile app lists it: `Ran <what for> ›`;
  // blue while it runs, a red mark when it failed. A click on the line opens
  // the engine's own row (the command, the diff, the output) beneath it. On
  // the main screen nothing takes a click, so the engine's rows stay.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !showTools || e.viewport?.isFullscreen === false) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const { tool, input, isErrored, isInterrupted, output } = e.props
    // A call waiting at the permission dialog has no result yet either.
    const isRunning = e.props.isRunning || (output === undefined && !isErrored && !isInterrupted)
    const member = memberOf(OPEN, e)
    const open = (await read($, member)) !== OPEN_BY_DEFAULT.has(tool)
    const toggle = () => void update($, member, v => !v)
    const room = Math.max(10, (e.viewport?.columns ?? 80) - 16)
    const label = clip(callLabel(tool, input, isRunning), room)
    const stat = isRunning || isErrored ? null : diffStat(tool, output)
    const mark = open ? '⌄' : '›'
    const tone: Tone = isErrored || isInterrupted ? 'failed' : isRunning ? 'running' : 'done'
    const joined = await joinsAbove($, e.requestId)
    return (
      <Box flexDirection="column" marginTop={joined ? 0 : 1}>
        {joined ? <Text {...TONES[tone]}>{JOIN_MARK}</Text> : null}
        <Box flexDirection="row">
          <Text {...TONES[tone]}>{STATE_MARK}</Text>
          {isInterrupted ? (
            <Text dimColor>Interrupted · </Text>
          ) : isErrored ? (
            <Text color="red">✗ </Text>
          ) : null}
          {isRunning ? (
            <Text color="blue">{label}…</Text>
          ) : (
            <Button plain dimColor key="line" label={label} onPress={toggle} />
          )}
          {stat ? (
            <Text>
              {' '}
              <Text color="green">+{String(stat.added)}</Text> <Text color="red">-{String(stat.removed)}</Text>
            </Text>
          ) : null}
          <Text> </Text>
          <Button plain dimColor key="mark" label={mark} onPress={toggle} />
        </Box>
        {open ? await next(e) : null}
      </Box>
    )
  })

  // The result under a standalone row: drawn while its row is open.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !showTools || e.viewport?.isFullscreen === false) return next(e)
    const open = (await read($, memberOf(OPEN, e))) !== OPEN_BY_DEFAULT.has(e.props.tool)
    const { Box } = $.ui.resolve(e)
    if (!open) return <Box />
    // An approved plan: the engine's lines above it, its lists drawn as a
    // reply's are, under the engine's `⎿` gutter.
    const pieces = e.props.tool === 'ExitPlanMode' && !e.props.isErrored ? planPieces(e.props.output) : null
    if (!pieces) return next(e)
    const output = e.props.output as Record<string, unknown>
    return (
      <Box flexDirection="column">
        {await next({ ...e, props: { ...e.props, output: { ...output, plan: JOINER } } })}
        <Box flexDirection="column" paddingLeft={5}>
          {setIn($.ui.resolve(e), pieces)}
        </Box>
      </Box>
    )
  })

  // A folded run of reads and searches: one dim count line; a press unfolds it
  // into a line per call, each of which opens on its own. A run of one call
  // unfolds into that call's row, opened, so its line is not drawn twice.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !showTools || e.viewport?.isFullscreen === false) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const { calls } = e.props
    const member = memberOf(OPEN, e)
    const open = e.props.isExpanded || (await read($, member))
    const only = calls.length === 1 ? calls[0]!.tool_use_id : undefined
    if (open && only !== undefined) return next({ ...e, props: { ...e.props, isExpanded: true } })
    const toggle = async () => {
      const now = await update($, member, v => !v)
      if (only !== undefined) await update($, memberOf(OPEN, { requestId: only }), () => now)
    }
    const running = calls.some(c => c.isRunning)
    const failed = calls.some(c => c.isErrored || c.isInterrupted)
    const tone: Tone = failed ? 'failed' : running ? 'running' : 'done'
    const room = Math.max(10, (e.viewport?.columns ?? 80) - 10)
    const label = clip(groupLabel(calls), room)
    const first = calls[0]
    const joined = first?.tool_use_id !== undefined && (await joinsAbove($, first.tool_use_id))
    return (
      <Box flexDirection="column" marginTop={joined ? 0 : 1}>
        {joined ? <Text {...TONES[tone]}>{JOIN_MARK}</Text> : null}
        <Box flexDirection="row">
          <Text {...TONES[tone]}>{STATE_MARK}</Text>
          {failed ? <Text color="red">✗ </Text> : null}
          {running ? (
            <Text color="blue">{label}…</Text>
          ) : (
            <Button plain dimColor key="line" label={label} onPress={() => void toggle()} />
          )}
          <Text> </Text>
          <Button plain dimColor key="mark" label={open ? '⌄' : '›'} onPress={() => void toggle()} />
        </Box>
        {open ? await next({ ...e, props: { ...e.props, isExpanded: true } }) : null}
      </Box>
    )
  })
}
