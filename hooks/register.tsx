import type { Register, $ } from 'claude-code'

import type { Step, StepStatus } from '../types'

const PANE = 'steps'
const TOOL = 'mcp__steps__set_steps'
const STEPS = { plugin: 'steps', key: 'steps' } as const

// The directory's review follows $ only through $.noun.method calls and functions
// in this file, so state goes through $.state, not the read/update helpers.
async function readSteps($: $): Promise<Step[]> {
  return (await $.state.get(STEPS)).value ?? []
}

// The app can hold the pane open but undrawn or behind another tab, so ask it.
async function isOnScreen($: $): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)
}

// Only /steps and the Steps button open the pane. A pane that opens by itself gets in the way.
// Returns whether the pane is shown afterwards.
async function togglePane($: $): Promise<boolean> {
  if (await isOnScreen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: 'Steps' })
  return true
}

const STATUSES: readonly StepStatus[] = ['todo', 'doing', 'done']

// Claude sends the whole list on every call, so the pane always shows its latest view.
function parseSteps(raw: unknown): Step[] | string {
  if (!Array.isArray(raw)) return 'steps must be an array'
  const out: Step[] = []
  for (const item of raw) {
    const title = typeof item?.title === 'string' ? item.title.trim() : ''
    const status = item?.status
    if (!title) return 'every step needs a non-empty title'
    if (!STATUSES.includes(status)) return `status must be one of ${STATUSES.join(', ')}`
    out.push({ title, status })
  }
  return out
}

const RULE = [
  '# Steps pane',
  `A Steps pane beside this conversation shows your plan. Keep it current with the ${TOOL} tool.`,
  '- For any request with 2 or more steps, call it before the first step with the full plan.',
  '- Research and investigation count as multi-step work: list the questions or places you will look.',
  '- Mark exactly one step "doing" while you work on it. Mark it "done" the moment it is finished,',
  '  in the same message as the first tool call of the next step. Do not batch updates for later.',
  '- Add, rename or drop steps when the plan changes. Always send the whole list.',
  '- Skip it only for a one-step answer.',
].join('\n')

// The rule is read once, so mid-turn nothing reminded Claude and the pane fell
// behind. Tool results now carry a short nudge the person never sees.
const STALE_AFTER = 6 // tool calls since the last set_steps, with steps still open
const PLAN_AFTER = 4 // tool calls in a request that has no list yet

// Module variables on purpose: a reload starts the count again, which is harmless.
let callsSinceUpdate = 0
let hasListThisRequest = false
let hasNudgedForPlan = false

function nudgeFor(list: Step[]): string | undefined {
  const open = list.filter(s => s.status !== 'done')
  if (open.length > 0 && callsSinceUpdate >= STALE_AFTER) {
    callsSinceUpdate = 0
    const doing = list.find(s => s.status === 'doing')
    const now = doing ? `"${doing.title}" is still marked doing` : 'no step is marked doing'
    return (
      `Steps pane: ${STALE_AFTER} tool calls since your last ${TOOL} call, and ${now}. ` +
      'If that step is finished or you moved on, call it now with the updated list.'
    )
  }
  if (!hasListThisRequest && !hasNudgedForPlan && open.length === 0 && callsSinceUpdate >= PLAN_AFTER) {
    hasNudgedForPlan = true
    return (
      `Steps pane: ${callsSinceUpdate} tool calls on this request and no list of steps. ` +
      `If this is more than one step (research counts), call ${TOOL} now with the plan.`
    )
  }
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'set_steps',
      description:
        'Replace the list of steps shown to the user in the side pane. Send the full list every time, in order. ' +
        'Use it to plan multi-step work and to mark progress as you go.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short step name, a few words' },
                status: { type: 'string', enum: STATUSES },
              },
              required: ['title', 'status'],
            },
          },
        },
        required: ['steps'],
      },
    })
    await $.command.register({ name: 'steps', description: 'Show or hide the Steps pane' })

    return next(e)
  })

  on('command.run', { command: 'steps' }, async $ => {
    const shown = await togglePane($)

    return { text: shown ? 'Steps pane shown.' : 'Steps pane hidden.' }
  })

  // The Steps button sits in the footer under the prompt, after the engine's own mode labels.
  // The desktop footer draws nothing for a Client (a plain-text control with a
  // hover-only fill), so both surfaces use a Button. Button has no padding prop,
  // so on the desktop non-breaking spaces widen its pill.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)
    const label = e.surface === 'desktop' ? '  Steps  ' : 'Steps'

    return (
      <Box>
        {await next(e)}
        <Button key="toggle" plain label={label} onPress={() => togglePane($)} />
      </Box>
    )
  })

  // Plugin tools sit behind ToolSearch by default, and Claude never looked set_steps up.
  // Keep its schema in the prompt so it is always callable.
  on('tool.describe', { tool: TOOL }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  // The rule is a system prompt section: read once per session and cached, not repeated per message.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    if (e.traits.includes('bare')) return out

    return { sections: [...out.sections, { id: 'steps:rule', text: RULE, scope: 'session' as const }] }
  })

  // A new message from the person is a new request: its own plan, its own count.
  on('prompt.submit', async ($, e, next) => {
    callsSinceUpdate = 0
    hasListThisRequest = false
    hasNudgedForPlan = false
    return next(e)
  })

  // Counts the main loop's tool calls; a subagent's calls are its own work.
  on('tool.call', async ($, e, next) => {
    if (e.tool === TOOL || e.agentId !== undefined) return next(e)
    const out = await next(e)
    if (out.deny !== undefined) return out
    callsSinceUpdate++
    const nudge = nudgeFor(await readSteps($))

    return nudge ? { ...out, context: [...(out.context ?? []), nudge] } : out
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseSteps((e as { steps?: unknown }).steps)
    if (typeof parsed === 'string') return { deny: parsed }
    callsSinceUpdate = 0
    hasListThisRequest = true
    await $.state.set(STEPS, parsed)
    const done = parsed.filter(s => s.status === 'done').length

    return { result: `Steps updated: ${done}/${parsed.length} done.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await readSteps($)
    const done = list.filter(s => s.status === 'done').length

    // Desktop: icons carry the state, text stays in the theme's own color.
    if (e.surface === 'desktop') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      if (list.length === 0) return <Text dimColor>No steps yet.</Text>

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column" gap={1}>
            {list.map(step => (
              <Box flexDirection="row" alignItems="center" gap={1}>
                <Svg source={ICONS[step.status]} alt={step.status} width={16} height={16} />
                <Text
                  bold={step.status === 'doing'}
                  dimColor={step.status === 'done'}
                  strikethrough={step.status === 'done'}
                  wrap="wrap"
                >
                  {step.title}
                </Text>
              </Box>
            ))}
          </Box>
          <Text dimColor>
            {done} of {list.length} done
          </Text>
        </Box>
      )
    }

    // Terminal: plain text, no color, the marker and weight carry the state.
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {list.map(step => (
          <Text bold={step.status === 'doing'} dimColor={step.status === 'done'} strikethrough={step.status === 'done'}>
            {step.status === 'done' ? '✓' : step.status === 'doing' ? '›' : '○'} {step.title}
          </Text>
        ))}
        <Text dimColor>{list.length === 0 ? 'No steps yet.' : `${done} of ${list.length} done`}</Text>
      </Box>
    )
  })
}

// Black and gray. "ink" is near-black on a light pane and near-white on a dark one,
// so the icons never vanish into the background; "paper" is the opposite, for the check.
const STYLE =
  '<style>.ink{fill:#1C1C1E;stroke:#1C1C1E}.paper{stroke:#FFFFFF}.gray{fill:#8E8E93;stroke:#8E8E93}' +
  '@media (prefers-color-scheme: dark){.ink{fill:#F2F2F7;stroke:#F2F2F7}.paper{stroke:#1C1C1E}}</style>'
const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${STYLE}${body}</svg>`

// The spinner: a faint ring with a quarter arc turning on it, one turn a second.
// The sandboxed frame (isInteractive) painted a white square on the dark pane,
// so the icon draws as a plain image. A CSS animation inside the SVG turns it,
// with no redraws from the engine.
const SPINNER = svg(
  '0 0 16 16',
  '<style>@keyframes spin{to{transform:rotate(360deg)}}.spin{transform-origin:8px 8px;animation:spin 1s linear infinite}</style>' +
    '<circle class="gray" cx="8" cy="8" r="6.5" style="fill:none" stroke-width="1.5" opacity="0.35"/>' +
    '<path class="ink spin" d="M8 1.5A6.5 6.5 0 0 1 14.5 8" style="fill:none" stroke-width="1.5" stroke-linecap="round"/>',
)

const ICONS: Record<StepStatus, string> = {
  todo: svg('0 0 16 16', '<circle class="gray" cx="8" cy="8" r="6.5" style="fill:none" stroke-width="1.5"/>'),
  doing: SPINNER,
  done: svg(
    '0 0 16 16',
    '<circle class="ink" cx="8" cy="8" r="7.25" style="stroke:none"/><path class="paper" d="M4.75 8.25l2.25 2.25 4.25-4.5" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
}
