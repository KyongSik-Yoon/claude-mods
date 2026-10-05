import type { PromptOrigin, Register, RenderInput } from 'claude-code'

// Origins whose text is the person's own prompt; everything else (task
// notifications, peers, channels) keeps the engine's row.
const OWN: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge'])

// Taller than any row; the rail's box clips it to the row's height.
const RAIL = Array.from({ length: 400 }, () => '▎').join('\n')

const WIDTHS = ['60%', '75%', '90%'] as const

type Tone = 'done' | 'running' | 'failed'

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
