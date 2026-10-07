// The main loop's model, as the last turn ran it.
export type Model = { id: string; effort?: string }

// The live context window, as the engine last measured it.
export type Context = { tokens?: number; window: number; percent?: number }

// The working copy's uncommitted changes, as the desktop app's diff stat reads.
export type Edits = { files: number; added: number; removed: number }

declare module 'claude-code' {
  interface PluginState {
    'desktop-look': {
      model: Model | null
      context: Context | null
      tools: string[]
      edits: Edits | null
      cost: number | null
      // The text the model wrote between two tool calls, which the transcript
      // sets apart as the mobile app does.
      narration: string[]
      // Whether a tool row shows what the engine draws under its one line.
      open: StateFamily<boolean>
    }
  }
}
