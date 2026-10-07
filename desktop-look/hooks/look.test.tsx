import type { On, RenderElement, RenderNode } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  between,
  callLabel,
  clip,
  cut,
  diffStat,
  dollars,
  fill,
  folded,
  groupLabel,
  joinedCalls,
  joinedIn,
  linesOf,
  listed,
  marks,
  mended,
  modelLabel,
  narrations,
  numstat,
  pressure,
  runningLabel,
  toolLabel,
} from './register'

// Every element of a drawn tree, outermost first.
const walk = (node: RenderNode): RenderElement[] =>
  typeof node === 'string' ? [] : [node, ...('children' in node ? (node.children ?? []).flatMap(walk) : [])]

type BoxElement = Extract<RenderElement, { type: 'Box' }>
const boxes = (tree: RenderElement) => walk(tree).filter((n): n is BoxElement => n.type === 'Box')
// One string per Text element, its pieces joined as drawn.
const texts = (tree: RenderElement) =>
  walk(tree).flatMap(n => (n.type === 'Text' ? [(n.children ?? []).filter(c => typeof c === 'string').join('')] : []))
// The labels of the Buttons drawn.
const labels = (tree: RenderElement) => walk(tree).flatMap(n => (n.type === 'Button' ? [n.props.label] : []))
// The markdown each Markdown element was given, in drawing order.
const markdown = (tree: RenderElement) => walk(tree).flatMap(n => (n.type === 'Markdown' ? [n.props.text] : []))
// The filled cells standing for a bar: a Box with a background and no children.
const bars = (tree: RenderElement) => boxes(tree).filter(b => b.props?.backgroundColor !== undefined && !b.children?.length)

const PROMPT = { text: '안녕, 이 파일 좀 봐줘', origin: { kind: 'composer' }, isExpanded: true } as const

const BASH = { tool: 'Bash', input: { command: 'ls -la', description: 'List files' }, isErrored: false, isInterrupted: false } as const

const TOOL = {
  ToolUse: { tool_use_id: 't1', ...BASH, isRunning: false, output: { stdout: '', stderr: '' } },
  ToolGroup: { calls: [{ ...BASH, isRunning: false }], isActive: false, isExpanded: false },
  ToolResult: { tool_use_id: 't1', tool: 'Bash', output: { stdout: '', stderr: '' }, isErrored: false },
} as const

// The test's hook stands for the engine: it draws its own row as ENGINE, and
// keeps the props it was asked to draw.
const engine = (on: On) => {
  const seen: Record<string, unknown>[] = []
  on('ui.render', ($, e) => {
    seen.push(e.props as Record<string, unknown>)
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  return seen
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the person's prompt`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'UserMessage', props: PROMPT })
    const tree = await ui.drawn()
    if (surface === 'terminal') {
      // No outline: one cell of the theme's Claude orange down its left, the
      // text a cell over.
      expect(boxes(tree).some(b => b.props?.borderStyle !== undefined)).toBe(false)
      expect(bars(tree)).toEqual([expect.objectContaining({ props: expect.objectContaining({ width: 1, backgroundColor: 'claude' }) })])
      expect(boxes(tree).some(b => b.props?.paddingLeft === 1)).toBe(true)
      expect(texts(tree)).toEqual([PROMPT.text])
      // The text in the terminal's own colour.
      expect(walk(tree).find(n => n.type === 'Text')?.props?.color).toBeUndefined()
    } else {
      expect(texts(tree)).toEqual(['ENGINE'])
    }
  })

  test(`${surface}: pasted text folds to the composer's placeholder, which a press opens`, async ($, on) => {
    engine(on)
    // As the engine frames it: `\n\n` before each block, `\n` after, the
    // pasted text on lines of its own between the tags.
    const block = (id: string, body: string) => `\n\n<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">\n`
    const text = `봐줘 ${block('ab06', '# 제목\n> 메모\n끝')}\n그리고${block('c1', 'a\nb')}`
    const props = { ...PROMPT, text, isExpanded: false }
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'UserMessage', props })
    if (surface !== 'terminal') {
      expect(texts(await ui.drawn())).toEqual(['ENGINE'])
      return
    }
    const shut = await ui.drawn()
    expect(texts(shut)).toEqual(['봐줘', ' ', '그리고', ' '])
    expect(labels(shut)).toEqual(['[Pasted text +2 lines]', '›', '[Pasted text +1 lines]', '›'])
    await ui.press({ key: 'paste-1' })
    const open = await ui.drawn()
    expect(texts(open)).toEqual(['봐줘', ' ', '# 제목\n> 메모\n끝', '그리고', ' '])
    expect(labels(open)).toEqual(['[Pasted text +2 lines]', '⌄', '[Pasted text +1 lines]', '›'])
  })

  test(`${surface}: in the ctrl+o transcript a paste is open`, async ($, on) => {
    engine(on)
    const text = `\n\n<pasted_content id="x">\na\nb\n</pasted_content id="x">\n`
    const tree = await (await $.ui.mount({ plugin: 'desktop-look', surface, component: 'UserMessage', props: { ...PROMPT, text } })).drawn()
    expect(texts(tree)).toEqual(surface === 'terminal' ? [' ', 'a\nb'] : ['ENGINE'])
  })

  test(`${surface}: a task notification keeps the engine's row`, async ($, on) => {
    engine(on)
    const props = { ...PROMPT, origin: { kind: 'task-notification' } } as const
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'UserMessage', props })
    expect(texts(await ui.drawn())).toEqual(['ENGINE'])
  })

  test(`${surface}: the reply's text ${surface === 'terminal' ? 'drops its bullet' : 'is left alone'}`, async ($, on) => {
    const seen = engine(on)
    const props = { text: '답이에요', isFirstOfReply: true }
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component: 'AssistantMessage', props })
    const tree = await ui.drawn()
    expect(texts(tree)).toEqual(['ENGINE'])
    expect(bars(tree)).toEqual([])
    expect(seen.at(-1)).toMatchObject({ text: '답이에요', isFirstOfReply: surface !== 'terminal' })
  })

  for (const component of ['ToolUse', 'ToolGroup', 'ToolResult'] as const) {
    test(`${surface}: ${component} ${surface === 'terminal' ? 'folds to one line' : 'is left alone'}`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ plugin: 'desktop-look', surface, component, props: TOOL[component] } as never)
      const tree = await ui.drawn()
      if (surface === 'terminal') {
        expect(texts(tree)).not.toContain('ENGINE')
        if (component !== 'ToolResult') expect(labels(tree)).toEqual(['Ran List files', '›'])
      } else {
        expect(texts(tree)).toEqual(['ENGINE'])
      }
    })
  }
}

// The main screen takes no clicks, so a folded line could never open there.
for (const component of ['ToolUse', 'ToolGroup', 'ToolResult'] as const) {
  test(`terminal main screen: ${component} keeps the engine's row`, async ($, on) => {
    engine(on)
    const viewport = { columns: 100, rows: 40, isFullscreen: false }
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component, props: TOOL[component], viewport } as never)
    expect(texts(await ui.drawn())).toEqual(['ENGINE'])
  })
}

const mountTool = ($: Engine, component: 'ToolUse' | 'ToolResult' | 'ToolGroup', props: object) =>
  $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component, requestId: 't1', props } as never)

test('terminal: a press opens the engine\'s row and its result, and a second folds them', async ($, on) => {
  engine(on)
  const row = await mountTool($, 'ToolUse', TOOL.ToolUse)
  const result = await mountTool($, 'ToolResult', TOOL.ToolResult)
  await row.press({ key: 'line' })
  expect(texts(await row.drawn())).toContain('ENGINE')
  expect(labels(await row.drawn())).toEqual(['Ran List files', '⌄'])
  expect(texts(await result.drawn())).toEqual(['ENGINE'])
  await row.press({ key: 'mark' })
  expect(texts(await row.drawn())).not.toContain('ENGINE')
  expect(texts(await result.drawn())).not.toContain('ENGINE')
})

const ROWS = [
  ['a running call', { ...TOOL.ToolUse, isRunning: true, output: undefined }, 'Running List files…', 'blue'],
  ['a call waiting at the dialog', { ...TOOL.ToolUse, output: undefined }, 'Running List files…', 'blue'],
  ['a failed call', { ...TOOL.ToolUse, isErrored: true, output: 'boom' }, '✗ ', 'red'],
] as const

for (const [name, props, shown, color] of ROWS) {
  test(`terminal: ${name} reads in ${color}`, async ($, on) => {
    engine(on)
    const tree = await (await mountTool($, 'ToolUse', props)).drawn()
    const text = walk(tree).find((n): n is Extract<RenderElement, { type: 'Text' }> => n.type === 'Text' && texts(n)[0] === shown)
    expect(text?.props).toMatchObject({ color })
  })
}

// The thin mark that opens a tool line, coloured by the call's state.
const MARKS = [
  ['a finished call', 'ToolUse', TOOL.ToolUse, { color: 'green' }],
  ['a running call', 'ToolUse', { ...TOOL.ToolUse, isRunning: true, output: undefined }, { color: 'blue' }],
  ['a failed call', 'ToolUse', { ...TOOL.ToolUse, isErrored: true, output: 'boom' }, { color: 'red' }],
  ['an interrupted call', 'ToolUse', { ...TOOL.ToolUse, isInterrupted: true, output: 'cut' }, { color: 'red' }],
  ['a finished group', 'ToolGroup', TOOL.ToolGroup, { color: 'green' }],
  ['a group with a running call', 'ToolGroup', { ...TOOL.ToolGroup, isActive: true, calls: [{ ...BASH, isRunning: false }, { ...BASH, isRunning: true }] }, { color: 'blue' }],
  ['a group with a failed call', 'ToolGroup', { ...TOOL.ToolGroup, calls: [{ ...BASH, isRunning: false }, { ...BASH, isErrored: true, isRunning: false }] }, { color: 'red' }],
] as const

for (const [name, component, props, style] of MARKS) {
  test(`terminal: the mark of ${name}`, async ($, on) => {
    engine(on)
    const tree = await (await mountTool($, component, props)).drawn()
    const first = walk(tree).find((n): n is Extract<RenderElement, { type: 'Text' }> => n.type === 'Text')
    expect(texts(first!)).toEqual(['▎ '])
    expect(first?.props).toMatchObject(style)
  })
}

test('terminal: a line reads as its label alone, the command left to the opened row', async ($, on) => {
  engine(on)
  const tree = await (await mountTool($, 'ToolUse', TOOL.ToolUse)).drawn()
  expect(labels(tree)).toEqual(['Ran List files', '›'])
  expect(texts(tree).join('')).not.toContain('ls -la')
  const calls = [
    { ...BASH, input: { command: 'wc -l a.ts' }, isRunning: false },
    { ...BASH, input: { command: 'git status', description: 'Look at the tree' }, isRunning: false },
  ]
  const group = await (await mountTool($, 'ToolGroup', { ...TOOL.ToolGroup, calls })).drawn()
  expect(labels(group)).toEqual(['Ran 2 commands', '›'])
  expect(texts(group).join('')).not.toContain('wc -l')
})

test('terminal: an interrupted call says so', async ($, on) => {
  engine(on)
  const tree = await (await mountTool($, 'ToolUse', { ...TOOL.ToolUse, isInterrupted: true, output: 'cut' })).drawn()
  expect(texts(tree)).toContain('Interrupted · ')
})

test('terminal: an edit shows its diff stat on the line', async ($, on) => {
  engine(on)
  const output = { filePath: '/src/a.ts', structuredPatch: [{ lines: ['+x', '+y', '-z'] }] }
  const props = { tool_use_id: 't1', tool: 'Edit', input: { file_path: '/src/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output }
  const tree = await (await mountTool($, 'ToolUse', props)).drawn()
  expect(labels(tree)[0]).toBe('Edited a.ts')
  expect(texts(tree)).toEqual(expect.arrayContaining(['+2', '-1']))
})

test('terminal: the todo list starts open', async ($, on) => {
  engine(on)
  const props = { tool_use_id: 't1', tool: 'TodoWrite', input: { todos: [] }, isRunning: false, isErrored: false, isInterrupted: false, output: {} }
  const row = await mountTool($, 'ToolUse', props)
  expect(texts(await row.drawn())).toContain('ENGINE')
  await row.press({ key: 'line' })
  expect(texts(await row.drawn())).not.toContain('ENGINE')
})

test('terminal: a press unfolds a group for the engine', async ($, on) => {
  const seen = engine(on)
  const calls = [
    { ...BASH, tool: 'Read', input: { file_path: '/a.ts' }, isRunning: false },
    { ...BASH, isRunning: false },
    { ...BASH, tool: 'Read', input: { file_path: '/b.ts' }, isRunning: false },
  ]
  const group = await mountTool($, 'ToolGroup', { ...TOOL.ToolGroup, calls })
  expect(labels(await group.drawn())).toEqual(['Read 2 files, ran 1 command', '›'])
  await group.press({ key: 'line' })
  expect(texts(await group.drawn())).toContain('ENGINE')
  expect(seen.at(-1)).toMatchObject({ isExpanded: true })
})

test('terminal: a run of one call unfolds into that call\'s row, opened', async ($, on) => {
  const seen = engine(on)
  const call = { ...BASH, tool_use_id: 'c1', isRunning: false, output: { stdout: '', stderr: '' } }
  const group = await mountTool($, 'ToolGroup', { ...TOOL.ToolGroup, calls: [call] })
  const row = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'ToolUse', requestId: 'c1', props: { ...call } })
  expect(texts(await row.drawn())).not.toContain('ENGINE')
  await group.press({ key: 'line' })
  expect(labels(await group.drawn())).toEqual([])
  expect(seen.some(p => p.isExpanded === true)).toBe(true)
  expect(texts(await row.drawn())).toContain('ENGINE')
})

// A transcript in Messages API form: a prompt, a reply's blocks, tool results.
type Api = { role: 'user' | 'assistant'; content: { type: string; [field: string]: unknown }[] }
const prompt = (text: string): Api => ({ role: 'user', content: [{ type: 'text', text }] })
const results: Api = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u', content: '' }] }
// A reply's blocks: a string is a text block, null a tool call.
const said = (...blocks: (string | null)[]): Api => ({
  role: 'assistant',
  content: blocks.map(b => (b === null ? { type: 'tool_use', id: 'u', name: 'Bash', input: {} } : { type: 'text', text: b })),
})

// The test's hooks stand for the engine; all of them go in before the first $ call.
const engineFor = (on: On, extra?: (on: On) => void, messages: Api[] = []) => {
  const seen = engine(on)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.model', () => ({ value: 'claude-haiku-4-5-20251001' }))
  // A breakdown asked for estimates 56k held.
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, ...(e.breakdown ? { breakdown: { categories: [], totalTokens: 56_000 } } : {}) },
      rateLimits: [],
      cost: { usd: 0 },
    },
  }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.id', () => ({ value: 's1' }))
  on('session.messages', () => ({ value: messages }))
  extra?.(on)
  return seen
}

const start = ($: Engine) =>
  $.session.start({ source: 'startup', cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

const reply = async ($: Engine, text: string) => {
  const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
  return ui.drawn()
}

const step = (index: number, answer: string, tools: number) =>
  ({ turnId: 't1', index, answer, toolUses: Array.from({ length: tools }, (_, i) => ({ id: `u${i}`, name: 'Bash', input: {} })), stop: { reason: tools ? 'tool_use' : 'end_turn' } }) as never

test('terminal: text between two tool calls gets the grey bar; the opening line and the answer do not', async ($, on) => {
  const answers = [step(0, '먼저 볼게요', 1), step(1, '이제 고칠게요', 1), step(2, '끝났어요', 0)]
  engineFor(on, on => on('turn.step', async function* () { return answers.shift()! }))
  await start($)
  for (const index of [0, 1, 2]) {
    for await (const _ of $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1 } as never)) void _
  }
  expect(bars(await reply($, '이제 고칠게요\n'))).toEqual([expect.objectContaining({ props: expect.objectContaining({ backgroundColor: 'subtle' }) })])
  expect(bars(await reply($, '먼저 볼게요'))).toEqual([])
  expect(bars(await reply($, '끝났어요'))).toEqual([])
})

test('terminal: a text after a tool call in the same response gets the bar', async ($, on) => {
  const chunks = [
    { kind: 'text', index: 0, text: '먼저 ' },
    { kind: 'text', index: 0, text: '볼게요' },
    { kind: 'tool', index: 1, id: 'u1', name: 'Read' },
    { kind: 'text', index: 2, text: '이어서 이것도' },
    { kind: 'tool', index: 3, id: 'u2', name: 'Grep' },
  ]
  engineFor(on, on =>
    on('turn.step', async function* () {
      for (const c of chunks) yield c as never
      return step(0, '먼저 볼게요이어서 이것도', 2)
    }),
  )
  await start($)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)) void _
  expect(bars(await reply($, '이어서 이것도'))).toHaveLength(1)
  expect(bars(await reply($, '먼저 볼게요'))).toEqual([])
})

test('terminal: a list between two tool calls is drawn beside the bar', async ($, on) => {
  engineFor(on, undefined, [prompt('go'), said('먼저', null), results, said('고칠 곳:\n- 하나\n- 둘', null), results, said('끝')])
  await start($)
  const tree = await reply($, '고칠 곳:\n- 하나\n- 둘')
  expect(bars(tree)).toHaveLength(1)
  expect(texts(tree)).toEqual(['• ', '• '])
  expect(markdown(tree)).toEqual(['고칠 곳:', '하나', '둘'])
})

test('terminal: a resumed transcript\'s narration is read off its messages', async ($, on) => {
  engineFor(on, undefined, [prompt('go'), said('먼저', null), results, said('그다음', null), results, said('끝')])
  await start($)
  expect(bars(await reply($, '그다음'))).toHaveLength(1)
  expect(bars(await reply($, '먼저'))).toEqual([])
})

test('narration: the text between a turn\'s first and last tool calls', () => {
  expect(between(['a', null, 'b', null, 'c'])).toEqual(['b'])
  expect(between(['a', null, 'b'], true)).toEqual(['a'])
  expect(between(['a', 'b'], true)).toEqual([])
  expect(narrations([prompt('go'), said('a', null), results, said('b', null), results, said('c')])).toEqual(['b'])
  // Blocks split across messages read the same.
  expect(narrations([prompt('go'), said('a'), said(null), results, said('b'), said(null), results, said('c')])).toEqual(['b'])
  // Two texts in one response, each between calls.
  expect(narrations([prompt('go'), said('a', null, 'b', null), results, said('c')])).toEqual(['b'])
  // A new prompt starts a new turn: its first line is an opening again.
  expect(narrations([prompt('go'), said('a', null), results, said('b'), prompt('again'), said('c', null)])).toEqual([])
})

const text = (t: string, gap = false) => ({ kind: 'text', text: t, gap })
const list = (marker: string, items: unknown[][], more: object = {}) => ({
  kind: 'list',
  marker,
  start: 1,
  loose: false,
  items,
  tasks: items.map(() => null),
  gap: false,
  ...more,
})
const rule = (gap = false) => ({ kind: 'rule', gap })
const quote = (pieces: unknown[], gap = false) => ({ kind: 'quote', pieces, gap })
const lines = (s: string) => cut(s.split('\n'))

test('lists: a reply is cut where its lists are', () => {
  expect(lines('앞 문단\n- a\n- b\n\n뒤 문단')).toEqual([text('앞 문단'), list('-', [[text('a')], [text('b')]]), text('뒤 문단', true)])
  // Nested items belong to theirs; numbered ones keep their delimiter.
  expect(lines('- a\n  - b\n  - c\n- d')).toEqual([list('-', [[text('a'), list('-', [[text('b')], [text('c')]])], [text('d')]])])
  expect(lines('3) x\n4) y')).toEqual([list(')', [[text('x')], [text('y')]], { start: 3 })])
  // A wrapped line with no indent carries on its item's paragraph.
  expect(lines('- a\nb')).toEqual([list('-', [[text('a\nb')]])])
  // An item's second paragraph stays in it, for the engine to space.
  expect(lines('1. a\n\n   more\n2. b')).toEqual([list('.', [[text('a\n\nmore')], [text('b')]])])
  // Blank lines between items: a loose list.
  expect(lines('- a\n\n- b')).toEqual([list('-', [[text('a')], [text('b')]], { loose: true })])
  // Another bullet character starts another list.
  expect(lines('- a\n* b')).toEqual([list('-', [[text('a')]]), list('*', [[text('b')]])])
})

test('lists: what is not a list stays the engine\'s', () => {
  // Code, even with a list in it.
  expect(lines('```js\n- 코드\n1. 번호\n```')).toEqual([text('```js\n- 코드\n1. 번호\n```')])
  expect(lines('- a\n  ```\n  - x\n  ```')).toEqual([list('-', [[text('a\n```\n- x\n```')]])])
  // A bold run at the start of a line, and dashes under a paragraph, which
  // make it a heading.
  expect(lines('**굵게** 시작\n제목\n---')).toEqual([text('**굵게** 시작\n제목\n---')])
  // A quote of text alone stays in the text.
  expect(lines('앞\n> 인용 **굵게**\n> > 중첩\n뒤')).toEqual([text('앞\n> 인용 **굵게**\n> > 중첩\n뒤')])
  // Within a paragraph only a list with text, numbered from 1, starts.
  expect(lines('문단\n2. 둘째')).toEqual([text('문단\n2. 둘째')])
  expect(lines('문단\n-')).toEqual([text('문단\n-')])
  expect(lines('문단\n1. 첫째')).toEqual([text('문단'), list('.', [[text('첫째')]])])
  expect(listed('목록 없는 답')).toBeNull()
  expect(listed('<context>x</context>\n- a')).toBeNull()
})

test('a prompt of only a paste folds to the composer\'s placeholder, no blank rows around it', () => {
  const log = Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n')
  expect(folded(`\n\n<pasted_content id="0931">\n${log}\n</pasted_content id="0931">\n`)).toBe('[Pasted text +8 lines]')
  expect(folded('그냥 글')).toBe('그냥 글')
})

test('lists: rules, quotes holding a list, and task boxes are cut out too', () => {
  expect(lines('* * *\n- - -\n문단\n\n---')).toEqual([rule(), rule(), text('문단'), rule(true)])
  // A quote's own lines, markers off, cut as any text; a lazy line carries on
  // its paragraph.
  expect(lines('> # 제목\n> - a\n> - b\n>\n> 뒤\n이어짐\n\n밖')).toEqual([
    quote([text('# 제목'), list('-', [[text('a')], [text('b')]]), text('뒤\n이어짐', true)]),
    text('밖', true),
  ])
  expect(lines('> > - 깊이')).toEqual([quote([quote([list('-', [[text('깊이')]])])])])
  expect(lines('- [ ] 할 일\n- [x] 끝\n- [X] 대문자\n- [ ]\n- 보통')).toEqual([
    list('-', [[text('할 일')], [text('끝')], [text('대문자')], [text('[ ]')], [text('보통')]], { tasks: [false, true, true, null, null] }),
  ])
  expect(listed('> 인용만')).toBeNull()
  expect(listed('구분\n\n---\n\n선')).not.toBeNull()
})

test('lists: numbers count from the start and line up; bullets follow the depth', () => {
  expect(marks(list('.', [[], [], []]) as never, 0)).toEqual(['1. ', '2. ', '3. '])
  expect(marks(list('.', [[], []], { start: 9 }) as never, 0)).toEqual([' 9. ', '10. '])
  expect(marks(list('-', [[]]) as never, 0)).toEqual(['• '])
  expect(marks(list('-', [[]]) as never, 1)).toEqual(['◦ '])
  expect(marks(list('*', [[]]) as never, 5)).toEqual(['▪ '])
  expect(marks(list('-', [[], [], []], { tasks: [false, true, null] }) as never, 0)).toEqual(['☐ ', '☑ ', '• '])
  expect(marks(list('.', [[], []], { tasks: [false, true] }) as never, 0)).toEqual(['1. ☐ ', '2. ☑ '])
})

test('terminal: a reply with a list is drawn here, its prose by the Markdown element', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'desktop-look',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '해결 방법\n1. **첫째:** 하나\n   - 곁들임\n1. 둘째\n\n끝.', isFirstOfReply: true },
  })
  const tree = await ui.drawn()
  expect(texts(tree)).toEqual(['1. ', '◦ ', '2. '])
  expect(markdown(tree)).toEqual(['해결 방법', '**첫째:** 하나', '곁들임', '둘째', '끝.'])
  // Set in from the left edge, as the apps indent a list.
  expect(boxes(tree).some(b => b.props?.paddingLeft === 2)).toBe(true)
})

test('terminal: a quote holding a list gets the dim bar, and a rule a dim line', async ($, on) => {
  engine(on)
  const props = { text: '> 인용\n> - 하나\n\n---\n\n끝', isFirstOfReply: true }
  const tree = await (await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'AssistantMessage', props })).drawn()
  const bar = boxes(tree).find(b => b.props?.position === 'absolute')
  expect(bar?.props).toEqual(expect.objectContaining({ width: 1, height: '100%', overflow: 'hidden' }))
  expect(texts(tree).map(t => t.charAt(0))).toEqual(['▎', '•', '─'])
  expect(markdown(tree)).toEqual(['인용', '하나', '끝'])
})

const J = '\u200B'

test('bold: a run CommonMark would leave as asterisks is mended beside its punctuation', () => {
  expect(mended('**"인용"**을 꼽았습니다')).toBe(`**"인용"${J}**을 꼽았습니다`)
  expect(mended('**foo()**를 호출합니다')).toBe(`**foo()${J}**를 호출합니다`)
  expect(mended('**정말?**이라고 물었습니다')).toBe(`**정말?${J}**이라고 물었습니다`)
  // The mirror: an opening run between a letter and a quote.
  expect(mended('한 줄로**"흠"** 이라고')).toBe(`한 줄로**${J}"흠"** 이라고`)
  // A code span closing the bold: the mark goes after the span, not in it.
  expect(mended('**`register.tsx`**를 고쳤어요')).toBe(`**\`register.tsx\`${J}**를 고쳤어요`)
})

test('bold: what CommonMark already reads, and code, stay as written', () => {
  for (const text of ['**설정 파일**을 읽습니다', '**"인용"** 을 꼽았습니다', '**"인용"**, 그리고', '목록 없는 답', '2**3은 8', '* * *\n***'])
    expect(mended(text)).toBe(text)
  expect(mended('`a**"b"**c`를')).toBe('`a**"b"**c`를')
  expect(mended('```\n**"인용"**을\n```')).toBe('```\n**"인용"**을\n```')
  expect(mended('\\**"인용"**을')).toBe(`\\**"인용"${J}**을`)
  // Mending twice adds nothing.
  const once = mended('**"인용"**을, **foo()**를')
  expect(mended(once)).toBe(once)
})

test('terminal: the engine is handed the mended text', async ($, on) => {
  const seen = engine(on)
  const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'AssistantMessage', props: { text: '**"인용"**을', isFirstOfReply: true } })
  await ui.drawn()
  expect(seen.at(-1)).toMatchObject({ text: `**"인용"${J}**을`, isFirstOfReply: false })
})

test('a call reads as the mobile app lists it', () => {
  expect(callLabel('Bash', { command: 'wc -l a.ts\nmore', description: 'Count lines' }, false)).toBe('Ran Count lines')
  expect(callLabel('Bash', { command: 'wc -l a.ts\nmore' }, true)).toBe('Running wc -l a.ts')
  expect(callLabel('Read', { file_path: '/x/y/register.tsx' }, false)).toBe('Read register.tsx')
  expect(callLabel('WebFetch', { url: 'https://news.hada.io/topic?id=1' }, false)).toBe('Fetched news.hada.io')
  expect(callLabel('TodoWrite', { todos: [] }, false)).toBe('Updated todos')
  expect(callLabel('mcp__claude_ai_Slack__slack_send_message', {}, false)).toBe('slack_send_message')
  expect(groupLabel([{ tool: 'Grep', input: {}, isRunning: false }, { tool: 'Glob', input: {}, isRunning: true }])).toBe('Searching 2 patterns')
  expect(groupLabel([{ tool: 'Read', input: { file_path: '/a.ts' }, isRunning: false }])).toBe('Read a.ts')
  // Tools with no verb of their own read by name, counted only past one.
  const asana = (tool: string) => ({ tool, input: {}, isRunning: false })
  expect(groupLabel([asana('ToolSearch'), asana('mcp__asana__asana_search_tasks'), asana('mcp__asana__asana_search_tasks')])).toBe(
    'ToolSearch, asana_search_tasks ×2',
  )
})

test('a line is cut to its room, counting Hangul as two cells', () => {
  expect(clip('abcdef', 6)).toBe('abcdef')
  expect(clip('abcdef', 4)).toBe('abc…')
  expect(clip('가나다라', 5)).toBe('가나…')
})

for (const [bubbleWidth, spacer] of [['60%', '40%'], ['90%', '10%'], [undefined, '25%']] as const) {
  test(`terminal: bubble width ${bubbleWidth ?? 'default'}`, { options: bubbleWidth ? { bubbleWidth } : {} }, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'UserMessage', props: PROMPT })
    // The room right of the bubble, at least this: the bubble keeps to the left edge.
    const row = boxes(await ui.drawn())[0]!
    const [bubble, room] = (row.children ?? []).filter((n): n is BoxElement => typeof n !== 'string' && n.type === 'Box')
    expect(bubble?.props?.flexShrink).toBe(1)
    expect(bars(bubble!)).toHaveLength(1)
    expect(room?.props).toMatchObject({ flexGrow: 1, minWidth: spacer })
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

test('terminal: a filling context reads in the theme\'s warning colour, not a named yellow', { options: { bandContext: true } }, async ($, on) => {
  engineFor(on)
  await start($)
  await $.session.measure({ context: { tokens: 328_000, window: 1_000_000, percent: 33 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  // The Text whose own strings hold the figure, not the one wrapping it.
  const shade = walk(await ui.drawn()).find(n => n.type === 'Text' && texts(n)[0]!.includes('33%'))
  expect(shade?.type === 'Text' && shade.props).toMatchObject({ color: 'warning' })
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

// A working copy: `a.ts` changed, `b.bin` binary, two new files not ignored.
const gitFor = (on: On, runs: string[][]) => {
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const [, command] = e.argv
    const stdout =
      command === 'rev-parse' ? '/repo\n' : command === 'diff' ? '2\t1\ta.ts\n-\t-\tb.bin\n' : command === 'ls-files' ? 'new.md\0pic.png\0' : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('fs.read', (_$, e) => ({ value: e.path === '/repo/new.md' ? 'one\ntwo\nthree\n' : 'PNG\0data' }) as never)
}

test('terminal: the band shows the working copy\'s uncommitted changes and the cost', async ($, on) => {
  const runs: string[][] = []
  engineFor(on, on => {
    gitFor(on, runs)
    on('tool.call', () => ({ result: {} }) as never)
  })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 0.42 }, changed: ['cost'] })
  const shown = await bandText($)
  expect(shown).toMatch(/^ ?4 files +\+5 +-1/)
  expect(shown).not.toContain('✎')
  expect(shown).toContain('$0.42')
  expect(shown).not.toContain('◆')
  // Counted as the session started and after the Edit, not after the Read.
  expect(runs.filter(r => r[1] === 'diff')).toEqual([
    ['git', 'diff', 'HEAD', '--numstat'],
    ['git', 'diff', 'HEAD', '--numstat'],
  ])
})

test('terminal: outside a repository the band shows no changes', async ($, on) => {
  engineFor(on, on => on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }) as never))
  await start($)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 0.42 }, changed: ['cost'] })
  expect(await bandText($)).toMatch(/^\$0\.42/)
})

test('git counts read as one stat', () => {
  expect(numstat('2\t1\ta.ts\n-\t-\tb.bin\n10\t0\tsrc/{a => b}.ts\n')).toEqual({ files: 3, added: 12, removed: 1 })
  expect(numstat('')).toEqual({ files: 0, added: 0, removed: 0 })
  expect(linesOf('a\nb')).toBe(2)
  expect(linesOf('a\nb\n')).toBe(2)
  expect(linesOf('')).toBe(0)
  expect(linesOf('x\0y')).toBeNull()
})

test('a call right after another, no text between, joins the line above', () => {
  expect(joinedCalls([{ id: 'a' }, { id: 'b' }, '설명', { id: 'c' }, '  ', { id: 'd' }])).toEqual([['b', 'd'], true])
  // Carried over from the step before: its last block was a call.
  expect(joinedCalls([{ id: 'e' }, '끝'], true)).toEqual([['e'], false])
  const use = (id: string) => ({ type: 'tool_use', id, name: 'Read', input: {} })
  const messages: Api[] = [
    prompt('봐줘'),
    { role: 'assistant', content: [{ type: 'text', text: '먼저 볼게요' }, use('r1')] },
    results,
    { role: 'assistant', content: [use('r2'), use('r3')] },
    results,
    { role: 'assistant', content: [{ type: 'text', text: '고칠게요' }, use('e1')] },
    results,
    prompt('다음'),
    { role: 'assistant', content: [use('n1')] },
  ]
  // A new prompt starts over: n1 is the first line of its turn.
  expect(joinedIn(messages as never)).toEqual(['r2', 'r3'])
})

test('terminal: a joined call draws its mark through the blank row above', async ($, on) => {
  const use = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: {} })
  engineFor(on, undefined, [prompt('봐줘'), { role: 'assistant', content: [use('t0'), use('t1')] }, results])
  await start($)
  const tree = await (await mountTool($, 'ToolUse', TOOL.ToolUse)).drawn()
  expect(boxes(tree)[0]?.props?.marginTop).toBe(0)
  expect(texts(tree).slice(0, 2)).toEqual(['▎', '▎ '])
})

test('running tools read by name, and fall back to a count when there is no room', () => {
  expect(toolLabel('mcp__claude_ai_Slack__slack_send_message')).toBe('slack_send_message')
  expect(toolLabel('Bash')).toBe('Bash')
  expect(runningLabel(['Read', 'Grep', 'Read', 'Read'], 40)).toBe('Read ×3, Grep')
  expect(runningLabel(['Read', 'Grep', 'Read', 'Read'], 8)).toBe('4 running')
})

test('context pressure follows the tokens held, or the window share, whichever bites first', () => {
  expect(pressure({ tokens: 230_000, window: 1_000_000, percent: 23 })).toBe('calm')
  expect(pressure({ tokens: 300_000, window: 1_000_000, percent: 30 })).toBe('warn')
  expect(pressure({ tokens: 500_000, window: 1_000_000, percent: 50 })).toBe('alert')
  expect(pressure({ tokens: 140_000, window: 200_000, percent: 70 })).toBe('warn')
  expect(pressure({ tokens: 180_000, window: 200_000, percent: 90 })).toBe('alert')
  expect(pressure({ window: 200_000 })).toBe('calm')
})

test('terminal: a compaction drops the band to the context it left, before the next response', { options: { bandContext: true } }, async ($, on) => {
  engineFor(on, on => on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }], tokensBefore: 150_000, tokensAfter: 10_000 })))
  await start($)
  await $.session.measure({ context: { tokens: 150_000, window: 200_000, percent: 75 }, rateLimits: [], changed: ['context'] })
  expect(await bandText($)).toContain('75% · 150k/200k')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  expect(await bandText($)).toContain('28% · 56k/200k')
})

const PLAN = { tool_use_id: 't1', tool: 'ExitPlanMode', isErrored: false }

test('terminal: an approved plan keeps the engine\'s lines and draws its lists with bullets', async ($, on) => {
  const seen = engine(on)
  const output = { plan: '# 계획\n\n- 하나\n  - 안쪽\n- 둘\n\n1. 먼저', isAgent: false, filePath: '/p.md' }
  const tree = await (await mountTool($, 'ToolResult', { ...PLAN, output })).drawn()
  expect(seen[0]?.output).toEqual({ ...output, plan: '​' })
  expect(texts(tree)).toEqual(['ENGINE', '• ', '◦ ', '• ', '1. '])
  expect(walk(tree).flatMap(n => (n.type === 'Markdown' ? [n.props.text] : []))).toEqual(['# 계획', '하나', '안쪽', '둘', '먼저'])
})

test('terminal: a plan without lists, or a refused one, is the engine\'s', async ($, on) => {
  const seen = engine(on)
  const output = { plan: '# 계획\n\n그냥 문단', isAgent: false }
  await (await mountTool($, 'ToolResult', { ...PLAN, output })).drawn()
  const props = { ...PLAN, tool_use_id: 't2', isErrored: true, output: { ...output, plan: '- a' } }
  await (await $.ui.mount({ plugin: 'desktop-look', surface: 'terminal', component: 'ToolResult', requestId: 't2', props })).drawn()
  expect(seen.map(p => (p.output as { plan: string }).plan)).toEqual(['# 계획\n\n그냥 문단', '- a'])
})
