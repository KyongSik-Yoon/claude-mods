import { expect, mock, test } from 'claude-code/testing'

import { cut, step } from './register'

const FULL = '안녕하세요. 이 문장은 부드럽게 한 글자씩 나타나야 합니다. '.repeat(4)

test('cut never splits a surrogate pair', () => {
  expect(cut('a😀b', 2)).toBe('a')
  expect(cut('a😀b', 3)).toBe('a😀')
})

test('step reveals at least two chars and drains a backlog in ~12 frames', () => {
  expect(step({ target: 100, shown: 99 })).toBe(100)
  expect(step({ target: 10, shown: 0 })).toBe(2)
  expect(step({ target: 1200, shown: 0 })).toBe(100)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a message drawn while the model streams types itself out`, async ($, on) => {
    // The test's own hooks stand for the engine: draw the text as handed down.
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    let release = () => {}
    const held = new Promise<void>(r => (release = r))
    on('turn.step', async function* ($, e) {
      await held
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stop: { reason: 'end_turn' } } as never
    })

    const clock = mock.clock(on)
    on('session.start', () => ({ cwd: '/tmp' }))
    await $.session.start({ source: 'startup', cwd: '/tmp', surface, isInteractive: true } as never)
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)
    const pumped = (async () => {
      for await (const _ of stream) void _
    })()
    await clock.advance(0)

    const ui = await $.ui.mount({
      plugin: 'smooth-stream',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg-1',
      props: { text: FULL, isFirstOfReply: true },
    })
    const shown = async () => (await ui.find({ type: 'Text' }))?.text ?? ''

    expect((await shown()).length).toBe(0)
    await clock.advance(33 * 3)
    const early = (await shown()).length
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(FULL.length)
    expect(FULL.startsWith(await shown())).toBe(true)

    await clock.advance(33 * 40)
    expect(await shown()).toBe(FULL)

    release()
    await pumped
  })

  test(`${surface}: a message drawn while idle shows whole`, async ($, on) => {
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    const clock = mock.clock(on)
    on('session.start', () => ({ cwd: '/tmp' }))
    await $.session.start({ source: 'startup', cwd: '/tmp', surface, isInteractive: true } as never)
    const ui = await $.ui.mount({
      plugin: 'smooth-stream',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg-old',
      props: { text: FULL, isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Text' }))?.text).toBe(FULL)
  })
}
