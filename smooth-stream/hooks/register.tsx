import type { Register } from 'claude-code'

const SHOWN = { plugin: 'smooth-stream', key: 'shown' } as const

// ~30 frames/s. Each frame reveals at least MIN_STEP chars, more when the
// backlog is large, so a burst of lines drains within CATCH_UP_FRAMES.
const FRAME_MS = 33
const MIN_STEP = 2
const CATCH_UP_FRAMES = 12

type Track = { target: number; shown: number }

// Never cut between the halves of a surrogate pair.
export const cut = (text: string, n: number): string => {
  const code = text.charCodeAt(n - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n)
}

export const step = (t: Track): number =>
  Math.min(t.target, t.shown + Math.max(MIN_STEP, Math.ceil((t.target - t.shown) / CATCH_UP_FRAMES)))

export const register: Register = on => {
  // Messages still being revealed, by message id.
  const tracks = new Map<string, Track>()
  // Messages drawn whole; a redraw (resize, scroll) must not replay them.
  const done = new Set<string>()
  // Main-loop model requests in flight: a message first drawn then is streaming.
  let live = 0

  on('session.start', ($, e, next) => {
    $.clock.every(FRAME_MS, () => {
      for (const [id, t] of tracks) {
        if (t.shown >= t.target) {
          if (live === 0) {
            tracks.delete(id)
            done.add(id)
          }
          continue
        }
        t.shown = step(t)
        void $.state.set({ ...SHOWN, id }, t.shown)
      }
    })

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    live += 1
    try {
      return yield* next(e)
    } finally {
      live -= 1
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const id = e.requestId
    const full = e.props.text
    let t = tracks.get(id)

    if (!t) {
      if (live === 0 || done.has(id)) {
        done.add(id)
        return next(e)
      }
      t = { target: full.length, shown: 0 }
      tracks.set(id, t)
    }
    t.target = full.length

    // Subscribes this message to its own counter: each frame redraws it alone.
    const { value } = await $.state.get({ ...SHOWN, id })
    const n = Math.min(value ?? t.shown, full.length)

    return n >= full.length ? next(e) : next({ ...e, props: { ...e.props, text: cut(full, n) } })
  })
}
