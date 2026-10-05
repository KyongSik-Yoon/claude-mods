// The main loop's model, as the last turn ran it.
export type Model = { id: string; effort?: string }

// The live context window, as the engine last measured it.
export type Context = { tokens?: number; window: number; percent?: number }

// What this session's file edits came to, as the desktop app's diff stat reads.
export type Edits = { session: string; files: string[]; added: number; removed: number }

declare module 'claude-code' {
  interface PluginState {
    'desktop-look': {
      model: Model | null
      context: Context | null
      tools: string[]
      edits: Edits | null
      cost: number | null
    }
  }
}
