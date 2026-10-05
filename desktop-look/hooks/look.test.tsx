import type { On, RenderElement, RenderNode } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// Every element of a drawn tree, outermost first.
const walk = (node: RenderNode): RenderElement[] =>
  typeof node === 'string' ? [] : [node, ...('children' in node ? (node.children ?? []).flatMap(walk) : [])]

type BoxElement = Extract<RenderElement, { type: 'Box' }>
const boxes = (tree: RenderElement) => walk(tree).filter((n): n is BoxElement => n.type === 'Box')
const texts = (tree: RenderElement) =>
  walk(tree).flatMap(n => (n.type === 'Text' ? (n.children ?? []).filter(c => typeof c === 'string') : []))

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
