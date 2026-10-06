import { atom, memberOf, read, update } from 'claude-code'
import type { PromptOrigin, Register, RenderNode } from 'claude-code'

import type { Context, Edits, Model } from '../types'

// Origins whose text is the person's own prompt; everything else (task
// notifications, peers, channels) keeps the engine's row.
const OWN: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge'])

const WIDTHS = ['60%', '75%', '90%'] as const

// The theme's own blue, which reads in either: rgb(87,105,247) in light,
// rgb(177,185,249) in dark.
const CALM_COLOR = 'suggestion'

// The prompt's bubble, filled as the mobile app fills it (#F0EFEB there; the
// theme's user-message grey, #F0F0F0 in light and a dark grey in dark). The
// fill sets it apart without an edge.
const BUBBLE_FILL = 'userMessageBackground'

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

const MODEL = atom({ plugin: 'desktop-look', key: 'model' } as const, null)
const CONTEXT = atom({ plugin: 'desktop-look', key: 'context' } as const, null)
const TOOLS = atom({ plugin: 'desktop-look', key: 'tools' } as const, [] as string[])
const EDITS = atom({ plugin: 'desktop-look', key: 'edits' } as const, null)
const COST = atom({ plugin: 'desktop-look', key: 'cost' } as const, null)
const NARRATION = atom({ plugin: 'desktop-look', key: 'narration' } as const, [] as string[])
const OPEN = atom({ plugin: 'desktop-look', key: 'open' } as const, false)

// Enough for a long session's worth of steps; older ones have scrolled away.
const NARRATION_KEPT = 300

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

type Block = { readonly type: string; readonly [field: string]: unknown }

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

const textArg = (input: unknown, key: string): string => {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' ? value.trim() : ''
}

// A Bash call's command as its first line; a longer script says there is more.
const commandOf = (input: unknown): string => {
  const [first = '', ...rest] = textArg(input, 'command').split('\n')
  return rest.length > 0 ? `${first} …` : first
}

// The commands a line shows beside its label, so what ran is on screen and
// not only the model's account of it: each Bash call's, unless the line is one
// call with no description, whose label is its command already.
export const commandsShown = (calls: readonly { tool: string; input: unknown }[]): string => {
  const only = calls.length === 1 ? calls[0] : undefined
  if (only && !(only.tool === 'Bash' && textArg(only.input, 'description'))) return ''
  return calls
    .filter(c => c.tool === 'Bash')
    .map(c => commandOf(c.input))
    .filter(Boolean)
    .join('; ')
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
      if (!kind) return `${toolLabel(tool)} ×${n}`
      return `${kind[running ? 0 : 1]} ${n} ${n === 1 ? kind[2] : kind[3]}`
    })
    .join(', ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

// Cells a string takes: two for Hangul, CJK and full-width forms, one otherwise.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const cells = (s: string): number => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0)

// A label and the commands beside it in one row of `room` cells, with the
// three of ` $ ` between: the commands keep a share, the label the rest.
export const fitLine = (label: string, command: string, room: number): [string, string] => {
  if (!command) return [clip(label, room), '']
  const share = Math.min(cells(command), Math.max(12, Math.floor(room * 0.45)))
  const shown = clip(label, Math.max(8, room - 3 - share))
  return [shown, clip(command, Math.max(4, room - 3 - cells(shown)))]
}

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

export const register: Register = (on, options) => {
  const width = WIDTHS.find(w => w === options.bubbleWidth) ?? '75%'
  const spacer = `${100 - parseInt(width, 10)}%`
  const showBand = options.showBand !== false
  const bandModel = options.bandModel === true
  const bandContext = options.bandContext === true

  // The band's figures: seeded when the session starts, then pushed by the
  // engine (each main-loop step, each measurement, each tool call).
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const [id, usage, session, messages] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      $.session.id(),
      $.session.messages({ as: 'api' }),
    ])
    await update($, MODEL, model => model ?? { id })
    await update($, CONTEXT, () => usage.context)
    await update($, COST, () => usage.cost?.usd ?? null)
    await update($, TOOLS, () => [])
    // A resumed transcript's text between tool calls, read off the messages.
    await update($, NARRATION, () => narrations(messages))
    // A reload keeps the session's tally; a new session (/clear) starts over.
    await update($, EDITS, edits => (edits?.session === session ? edits : { session, files: [], added: 0, removed: 0 }))
    return started
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const model: Model = e.effort === undefined ? { id: e.model } : { id: e.model, effort: String(e.effort) }
    await update($, MODEL, () => model)
    // The response's blocks as they stream: each text, and where calls sit.
    const blocks = new Map<number, string | null>()
    const stream = next(e)
    let item = await stream.next()
    while (!item.done) {
      const chunk = item.value
      if (chunk.kind === 'text') blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
      else if (chunk.kind === 'tool') blocks.set(chunk.index, null)
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

  on('tool.call', async ($, e, next) => {
    const label = toolLabel(e.tool)
    await update($, TOOLS, tools => [...tools, label])
    try {
      const done = await next(e)
      const stat = 'result' in done && !done.isError ? diffStat(e.tool, done.result) : null
      if (stat) {
        await update($, EDITS, (edits: Edits | null): Edits => {
          const base = edits ?? { session: '', files: [], added: 0, removed: 0 }
          return {
            session: base.session,
            files: base.files.includes(stat.file) ? base.files : [...base.files, stat.file],
            added: base.added + stat.added,
            removed: base.removed + stat.removed,
          }
        })
      }
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
    const edited = edits && edits.files.length > 0 ? edits : null
    const spent = cost !== null && cost > 0 ? cost : null
    if (!model && context?.percent === undefined && tools.length === 0 && !edited && spent === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    // The left: what this session changed and spent, then the model when on.
    const left: RenderNode[] = []
    if (edited) {
      left.push(
        <Text>
          <Text dimColor>✎ {String(edited.files.length)} {edited.files.length === 1 ? 'file' : 'files'} </Text>
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
        (edited ? `✎ ${edited.files.length} files +${edited.added} -${edited.removed}`.length + 2 : 0) +
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

  // The person's prompt as a filled bubble on the right, as the
  // desktop and mobile apps set it; at most `width` of the terminal wide.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || !OWN.has(e.props.origin.kind) || e.props.from || e.props.task) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box flexGrow={1} minWidth={spacer} />
        <Box flexShrink={1} backgroundColor={BUBBLE_FILL} paddingX={1}>
          <Text wrap="wrap">
            {e.props.text}
          </Text>
        </Box>
      </Box>
    )
  })

  // The reply's text without the bullet, flush left as the mobile app sets it;
  // the text between two tool calls beside a grey bar. The engine still draws
  // the markdown, so another mod that rewrites the text composes with this.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const plain = { ...e, props: { ...e.props, isFirstOfReply: false } }
    if (e.props.isSummary || !(await read($, NARRATION)).includes(e.props.text.trim())) return next(plain)
    const { Box } = $.ui.resolve(e)
    // The engine's drawing opens with a blank row, which the bar skips.
    return (
      <Box flexDirection="row">
        <Box width={1} flexShrink={0} marginTop={1} backgroundColor={NARRATION_COLOR} />
        <Box flexShrink={1} flexGrow={1} paddingLeft={1}>
          {await next(plain)}
        </Box>
      </Box>
    )
  })

  // A tool call as one dim line, as the mobile app lists it: `Ran <what for> ›`;
  // blue while it runs, a red mark when it failed. A click on the line opens
  // the engine's own row (the command, the diff, the output) beneath it. On
  // the main screen nothing takes a click, so the engine's rows stay.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen === false) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const { tool, input, isErrored, isInterrupted, output } = e.props
    // A call waiting at the permission dialog has no result yet either.
    const isRunning = e.props.isRunning || (output === undefined && !isErrored && !isInterrupted)
    const member = memberOf(OPEN, e)
    const open = (await read($, member)) !== OPEN_BY_DEFAULT.has(tool)
    const toggle = () => void update($, member, v => !v)
    const room = Math.max(10, (e.viewport?.columns ?? 80) - 16)
    const [label, command] = fitLine(callLabel(tool, input, isRunning), commandsShown([{ tool, input }]), room)
    const stat = isRunning || isErrored ? null : diffStat(tool, output)
    const mark = open ? '⌄' : '›'
    const tone: Tone = isErrored || isInterrupted ? 'failed' : isRunning ? 'running' : 'done'
    return (
      <Box flexDirection="column" marginTop={1}>
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
          {command ? (
            <Text>
              <Text dimColor> $ </Text>
              {command}
            </Text>
          ) : null}
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
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen === false) return next(e)
    const open = (await read($, memberOf(OPEN, e))) !== OPEN_BY_DEFAULT.has(e.props.tool)
    if (open) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // A folded run of reads and searches: one dim count line; a press unfolds it
  // into a line per call, each of which opens on its own. A run of one call
  // unfolds into that call's row, opened, so its line is not drawn twice.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen === false) return next(e)
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
    const [label, command] = fitLine(groupLabel(calls), commandsShown(calls), room)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text {...TONES[tone]}>{STATE_MARK}</Text>
          {failed ? <Text color="red">✗ </Text> : null}
          {running ? (
            <Text color="blue">{label}…</Text>
          ) : (
            <Button plain dimColor key="line" label={label} onPress={() => void toggle()} />
          )}
          {command ? (
            <Text>
              <Text dimColor> $ </Text>
              {command}
            </Text>
          ) : null}
          <Text> </Text>
          <Button plain dimColor key="mark" label={open ? '⌄' : '›'} onPress={() => void toggle()} />
        </Box>
        {open ? await next({ ...e, props: { ...e.props, isExpanded: true } }) : null}
      </Box>
    )
  })
}
