import type { On, RenderElement, RenderNode } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { diffStat, dollars, fill, modelLabel, runningLabel, toolLabel } from './register'

// Every element of a drawn tree, outermost first.
const walk = (node: RenderNode): RenderElement[] =>
  typeof node === 'string' ? [] : [node, ...('children' in node ? (node.children ?? []).flatMap(walk) : [])]

type BoxElement = Extract<RenderElement, { type: 'Box' }>
const boxes = (tree: RenderElement) => walk(tree).filter((n): n is BoxElement => n.type === 'Box')
// One string per Text element, its pieces joined as drawn.
const texts = (tree: RenderElement) =>
  walk(tree).flatMap(n => (n.type === 'Text' ? [(n.children ?? []).filter(c => typeof c === 'string').join('')] : []))

const PROMPT = { text: '안녕, 이 파일 좀 봐줘', origin: { kind: 'composer' }, isExpanded: true } as const

const TOOL = {
  ToolUse: { tool_use_id: 't1', tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false },
  ToolGroup: { calls: [], isActive: false, isExpanded: false },
  ToolResult: { tool_use_id: 't1', tool: 'Edit', output: {}, isErrored: false },
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  // The test's hook stands for the engine: it draws its own row as ENGINE.
  const engine = (on: On) =>
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })

  test(`${surface}: the person's prompt`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'UserMessage', props: PROMPT })
    const tree = await ui.drawn()
    if (surface === 'terminal') {
      expect(boxes(tree).some(b => b.props?.borderStyle === 'round')).toBe(true)
      expect(boxes(tree)[0]?.props?.justifyContent).toBe('flex-end')
      expect(texts(tree)).toEqual([PROMPT.text])
    } else {
      expect(texts(tree)).toEqual(['ENGINE'])
    }
  })

  test(`${surface}: a task notification keeps the engine's row`, async ($, on) => {
    engine(on)
    const props = { ...PROMPT, origin: { kind: 'task-notification' } } as const
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'UserMessage', props })
    expect(texts(await ui.drawn())).toEqual(['ENGINE'])
  })

  for (const [component, skip] of [['ToolUse', 1], ['ToolGroup', 1], ['ToolResult', 0]] as const) {
    test(`${surface}: ${component} ${surface === 'terminal' ? 'gets a rail' : 'is left alone'}`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component, props: TOOL[component] } as never)
      const tree = await ui.drawn()
      expect(texts(tree)).toContain('ENGINE')
      const rail = boxes(tree).find(b => b.props?.position === 'absolute')
      if (surface === 'terminal') {
        expect(rail?.props).toMatchObject({ top: skip, bottom: 0, width: 1, overflow: 'hidden' })
      } else {
        expect(rail).toBeUndefined()
      }
    })
  }
}

// The rail's Text: the one under the absolutely placed Box.
const railText = (tree: RenderElement) => {
  const rail = boxes(tree).find(b => b.props?.position === 'absolute')
  return rail?.children?.find((c): c is Extract<RenderElement, { type: 'Text' }> => typeof c !== 'string' && c.type === 'Text')
}

const CALL = { tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false } as const

const STATES = [
  ['a running call', 'ToolUse', { ...TOOL.ToolUse, isRunning: true }, { color: 'blue' }],
  ['an errored call', 'ToolUse', { ...TOOL.ToolUse, isErrored: true }, { color: 'red' }],
  ['an interrupted call', 'ToolUse', { ...TOOL.ToolUse, isInterrupted: true }, { color: 'red' }],
  ['a finished call', 'ToolUse', TOOL.ToolUse, { dimColor: true }],
  ['an errored result', 'ToolResult', { ...TOOL.ToolResult, isErrored: true }, { color: 'red' }],
  ['a group with a running call', 'ToolGroup', { ...TOOL.ToolGroup, isActive: true, calls: [CALL, { ...CALL, isRunning: true }] }, { color: 'blue' }],
  ['the background hint under a running call', 'ToolProgress', { tool_use_id: 't1', kind: 'background_hint', hint: '(ctrl+b to run in background)' }, { color: 'blue' }],
  ['a group with a failed call', 'ToolGroup', { ...TOOL.ToolGroup, calls: [CALL, { ...CALL, isErrored: true }] }, { color: 'red' }],
] as const

for (const [name, component, props, style] of STATES) {
  test(`terminal: the rail of ${name}`, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component, props } as never)
    expect(railText(await ui.drawn())?.props).toMatchObject(style)
  })
}

for (const [bubbleWidth, spacer] of [['60%', '40%'], ['90%', '10%'], [undefined, '25%']] as const) {
  test(`terminal: bubble width ${bubbleWidth ?? 'default'}`, { options: bubbleWidth ? { bubbleWidth } : {} }, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'UserMessage', props: PROMPT })
    expect(boxes(await ui.drawn())[1]?.props?.width).toBe(spacer)
  })
}

test('model ids read as the desktop app names them', () => {
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 · 1M')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelLabel('opus')).toBe('Opus')
  expect(modelLabel('gpt-x')).toBe('gpt-x')
})

test('the context fill is ten cells', () => {
  expect(fill(0)).toEqual(['', '──────────'])
  expect(fill(23)).toEqual(['━━', '────────'])
  expect(fill(100)).toEqual(['━━━━━━━━━━', ''])
})

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
} as const

// The test's hooks stand for the engine; all of them go in before the first $ call.
const engineFor = (on: On, extra?: (on: On) => void) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.model', () => ({ value: 'claude-haiku-4-5-20251001' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.id', () => ({ value: 's1' }))
  extra?.(on)
}

const start = ($: Engine) =>
  $.session.start({ source: 'startup', cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

const bandText = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', props: object = BAND) => {
  const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'AbovePrompt', props } as never)
  return texts(await ui.drawn()).join(' ')
}

test('terminal: the band shows the model as the session starts', { options: { bandModel: true, bandContext: true } }, async ($, on) => {
  engineFor(on)
  await start($)
  const shown = await bandText($)
  expect(shown).toContain('◆ Haiku 4.5')
  expect(shown).not.toContain('━')
  expect(shown).toContain('ENGINE')
})

test('terminal: the band follows the main loop\'s model and the measured context', { options: { bandModel: true, bandContext: true } }, async ($, on) => {
  engineFor(on, on =>
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stop: { reason: 'end_turn' } } as never
    }),
  )
  await start($)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', effort: 'xhigh', messageCount: 1 } as never)) void _
  await $.session.measure({ context: { tokens: 230_000, window: 1_000_000, percent: 23 }, rateLimits: [], changed: ['context'] })
  const shown = await bandText($)
  expect(shown).toContain('◆ Opus 5.5 · 1M · xhigh')
  expect(shown).toMatch(/━━ +──────── +23% · 230k\/1M/)
  expect(shown).toContain('230k/1M')
})

test('terminal: the band counts tool calls while they run', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  engineFor(on, on =>
    on('tool.call', async () => {
      await held
      return { result: { stdout: '', stderr: '' } } as never
    }),
  )
  const clock = mock.clock(on)
  await start($)
  const call = $.tool.call({ tool: 'Bash', command: 'true' } as never)
  await clock.advance(0)
  expect(await bandText($)).toContain('↻ Bash')
  release()
  await call
  expect(await bandText($)).not.toContain('running')
})

test('terminal: a survey keeps the band for itself', { options: { bandModel: true } }, async ($, on) => {
  engineFor(on)
  await start($)
  expect(await bandText($, 'terminal', { ...BAND, hasSurvey: true })).toBe('ENGINE')
})

test('desktop: the band is left to the app', { options: { bandModel: true } }, async ($, on) => {
  engineFor(on)
  await start($)
  expect(await bandText($, 'desktop')).toBe('ENGINE')
})

test('terminal: showBand off leaves the band alone', { options: { showBand: false } }, async ($, on) => {
  engineFor(on)
  await start($)
  expect(await bandText($)).toBe('ENGINE')
})

test('terminal: by default the band shows only tools running', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  engineFor(on, on =>
    on('tool.call', async () => {
      await held
      return { result: { stdout: '', stderr: '' } } as never
    }),
  )
  const clock = mock.clock(on)
  await start($)
  await $.session.measure({ context: { tokens: 230_000, window: 1_000_000, percent: 23 }, rateLimits: [], changed: ['context'] })
  expect(await bandText($)).toBe('ENGINE')
  const call = $.tool.call({ tool: 'Bash', command: 'true' } as never)
  await clock.advance(0)
  const shown = await bandText($)
  expect(shown).toContain('↻ Bash')
  expect(shown).not.toContain('◆')
  expect(shown).not.toContain('━')
  release()
  await call
  expect(await bandText($)).toBe('ENGINE')
})

test('an Edit or Write counts its patch lines; a new file counts its content', () => {
  const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }]
  expect(diffStat('Edit', { filePath: '/x.ts', structuredPatch: patch })).toEqual({ file: '/x.ts', added: 2, removed: 1 })
  expect(diffStat('Write', { type: 'create', filePath: '/y.ts', structuredPatch: [], content: 'one\ntwo\n' })).toEqual({ file: '/y.ts', added: 2, removed: 0 })
  expect(diffStat('Bash', { stdout: '' })).toBeNull()
})

test('cost reads as the desktop app shows it', () => {
  expect(dollars(0.004)).toBe('<$0.01')
  expect(dollars(1.234)).toBe('$1.23')
})

test('terminal: the band tallies this session\'s edits and cost', async ($, on) => {
  engineFor(on, on =>
    on('tool.call', (_$, e) => {
      const file = (e as unknown as { file_path: string }).file_path
      return { result: { filePath: file, structuredPatch: [{ lines: ['+x', '+y', '-z'] }] } } as never
    }),
  )
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/b.ts' } as never)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 0.42 }, changed: ['cost'] })
  const shown = await bandText($)
  expect(shown).toMatch(/✎ 2 files +\+6 +-3/)
  expect(shown).toContain('$0.42')
  expect(shown).not.toContain('◆')
})

test('running tools read by name, and fall back to a count when there is no room', () => {
  expect(toolLabel('mcp__claude_ai_Slack__slack_send_message')).toBe('slack_send_message')
  expect(toolLabel('Bash')).toBe('Bash')
  expect(runningLabel(['Read', 'Grep', 'Read', 'Read'], 40)).toBe('Read ×3, Grep')
  expect(runningLabel(['Read', 'Grep', 'Read', 'Read'], 8)).toBe('4 running')
})
