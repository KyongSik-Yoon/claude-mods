import { atom, read, update } from 'claude-code'
import type { PromptOrigin, Register, RenderInput, RenderNode } from 'claude-code'

import type { Context, Edits, Model } from '../types'

// Origins whose text is the person's own prompt; everything else (task
// notifications, peers, channels) keeps the engine's row.
const OWN: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge'])

// Taller than any row; the rail's box clips it to the row's height.
const RAIL = Array.from({ length: 400 }, () => '▎').join('\n')

const WIDTHS = ['60%', '75%', '90%'] as const

type Tone = 'done' | 'running' | 'failed'

const MODEL = atom({ plugin: 'desktop-look', key: 'model' } as const, null)
const CONTEXT = atom({ plugin: 'desktop-look', key: 'context' } as const, null)
const TOOLS = atom({ plugin: 'desktop-look', key: 'tools' } as const, [] as string[])
const EDITS = atom({ plugin: 'desktop-look', key: 'edits' } as const, null)
const COST = atom({ plugin: 'desktop-look', key: 'cost' } as const, null)

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

const short = (n: number): string =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`

// Ten cells, as the desktop app's context ring reads at a glance: the filled
// run and the empty one. Box-drawing glyphs, which every terminal draws one
// cell wide.
export const fill = (percent: number): [string, string] => {
  const cells = Math.min(10, Math.max(0, Math.round(percent / 10)))
  return ['━'.repeat(cells), '─'.repeat(10 - cells)]
}

// The rail's colour follows the call: running, failed (an error, a refusal at
// the dialog, an interrupt) or done. Named colours, so the terminal's palette
// picks the shade for a light or dark theme.
export const tone = (e: RenderInput<'ToolUse' | 'ToolGroup' | 'ToolResult' | 'ToolProgress'>): Tone => {
  switch (e.component) {
    case 'ToolProgress':
      return 'running'
    case 'ToolUse':
      return e.props.isErrored || e.props.isInterrupted ? 'failed' : e.props.isRunning ? 'running' : 'done'
    case 'ToolGroup':
      return e.props.calls.some(c => c.isErrored || c.isInterrupted)
        ? 'failed'
        : e.props.calls.some(c => c.isRunning)
          ? 'running'
          : 'done'
    case 'ToolResult':
      return e.props.isErrored ? 'failed' : 'done'
  }
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
    const [id, usage, session] = await Promise.all([$.session.model(), $.session.usage(), $.session.id()])
    await update($, MODEL, model => model ?? { id })
    await update($, CONTEXT, () => usage.context)
    await update($, COST, () => usage.cost?.usd ?? null)
    await update($, TOOLS, () => [])
    // A reload keeps the session's tally; a new session (/clear) starts over.
    await update($, EDITS, edits => (edits?.session === session ? edits : { session, files: [], added: 0, removed: 0 }))
    return started
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const model: Model = e.effort === undefined ? { id: e.model } : { id: e.model, effort: String(e.effort) }
      await update($, MODEL, () => model)
    }
    return yield* next(e)
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
      const shade = context.percent >= 90 ? { color: 'red' } : context.percent >= 70 ? { color: 'yellow' } : { dimColor: true }
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

  // The person's prompt as a right-aligned bubble, at most `width` wide.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || !OWN.has(e.props.origin.kind) || e.props.from || e.props.task) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" justifyContent="flex-end" marginTop={1}>
        <Box width={spacer} flexShrink={0} />
        <Box flexShrink={1} borderStyle="round" borderDimColor paddingX={1}>
          <Text wrap="wrap">{e.props.text}</Text>
        </Box>
      </Box>
    )
  })

  // A tool row, its live progress and its result are separate sites; one rail
  // down their left edge reads them as one card. The engine still draws what
  // is inside, so each tool's own summary and diff stay as they are. A tool
  // row opens with a blank line of the engine's, which the rail skips.
  on('ui.render', { component: ['ToolUse', 'ToolGroup', 'ToolProgress', 'ToolResult'] }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const skip = e.component === 'ToolUse' || e.component === 'ToolGroup' ? 1 : 0
    const now = tone(e)
    return (
      <Box paddingLeft={2}>
        <Box position="absolute" left={0} top={skip} bottom={0} width={1} overflow="hidden">
          {now === 'done' ? (
            <Text dimColor>{RAIL}</Text>
          ) : (
            <Text color={now === 'running' ? 'blue' : 'red'}>{RAIL}</Text>
          )}
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
