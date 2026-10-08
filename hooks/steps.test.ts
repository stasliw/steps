import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const TOOL = 'mcp__steps__set_steps'

// A deferred tool hides its schema behind ToolSearch, and Claude in a new
// session never looked it up. The mod must keep set_steps in the prompt.
test('set_steps is listed in the prompt, not behind ToolSearch', async ($, on) => {
  on('tool.describe', { tool: TOOL }, (_$, e) => ({ description: e.description, isDeferred: true }))

  const out = await $.tool.describe({
    tool: TOOL,
    description: 'Replace the list of steps',
    isDeferred: true,
    provider: { plugin: 'steps', tier: 'user' },
  })

  expect(out.isDeferred).toBe(false)
})

// The rule is a standing instruction: it belongs in the system prompt, read once
// and cached, not repeated beside every message the person sends.
test('the rule is a system prompt section, not per-prompt context', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [TOOL],
    outputStyle: null,
    traits: [],
  })
  const submitted = await $.prompt.submit({ text: 'hi' })

  expect(composed.sections.find(s => s.id === 'steps:rule')?.scope).toBe('session')
  expect(submitted.context ?? []).toEqual([])
})

// /steps opens and closes the pane, as does the Steps button in the footer.
test('/steps opens and closes the pane', async ($, on) => {
  const seen: string[] = []
  let isOpen = false
  on('ui.panes', () => ({ value: isOpen ? [pane(true)] : [] }))
  on('ui.open', { id: 'steps' }, () => {
    seen.push('open')
    isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', { id: 'steps' }, () => {
    seen.push('close')
    isOpen = false
    return { value: undefined }
  })

  const first = await $.command.run({ command: 'steps', args: '' })
  const second = await $.command.run({ command: 'steps', args: '' })

  expect(seen).toEqual(['open', 'close'])
  expect([first.text, second.text]).toEqual(['Steps pane shown.', 'Steps pane hidden.'])
})

// A pane that opens by itself gets in the way. Only /steps and the Steps button open it.
test('the pane never opens by itself, at session start or on set_steps', async ($, on) => {
  const seen: string[] = []
  const commands: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('command.register', (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', { id: 'steps' }, () => {
    seen.push('open')
    return { value: { isPlaced: true as const } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: TOOL, steps:[{ title: 'Plan it', status: 'doing' }] })

  expect(seen).toEqual([])
  expect(commands).toEqual(['steps'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane draws every step (${surface})`, async ($, on) => {
    on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
    await $.tool.call({
      tool: TOOL,
      steps:[
        { title: 'Plan it', status: 'done' },
        { title: 'Build it', status: 'doing' },
        { title: 'Ship it', status: 'todo' },
      ],
    })
    const ui = await $.ui.mount({
      plugin: 'steps',
      surface,
      component: 'Pane',
      requestId: 'steps',
      props: { title: 'Steps', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } },
    })

    expect(await ui.find({ text: '1 of 3 done' })).toBeDefined()
    for (const title of ['Plan it', 'Build it', 'Ship it']) expect(await ui.find({ text: title })).toBeDefined()
  })

}

// An open pane follows Claude: each set_steps call draws it again with the new list.
test('an open pane redraws when the steps change', async ($, on) => {
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
  await $.tool.call({ tool: TOOL, steps: [{ title: 'Plan it', status: 'doing' }] })
  const ui = await mountDesktopPane($)

  await $.tool.call({ tool: TOOL, steps: [{ title: 'Plan it', status: 'done' }, { title: 'Build it', status: 'doing' }] })

  expect(await ui.find({ text: 'Build it' })).toBeDefined()
  expect(await ui.find({ text: '1 of 2 done' })).toBeDefined()
})

// A "Steps" button sits in the footer, beside the mode labels.
// Stands in for the engine's own labels and records each open and close.
function footer(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('ui.render', { component: 'SessionMode' }, () => h('Text', null, 'focus') as never)
  const seen: string[] = []
  let isOpen = false
  on('ui.panes', () => ({ value: isOpen ? [pane(true)] : [] }))
  on('ui.open', { id: 'steps' }, () => {
    seen.push('open')
    isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', { id: 'steps' }, () => {
    seen.push('close')
    isOpen = false
    return { value: undefined }
  })
  return seen
}

function mountFooter($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop') {
  return $.ui.mount({ plugin: 'steps', surface, component: 'SessionMode', props: { modes: [] } })
}

test('the Steps button opens and closes the pane (terminal)', async ($, on) => {
  const seen = footer(on)
  const ui = await mountFooter($, 'terminal')

  expect((await ui.find({ key: 'toggle' }))?.text).toBe('Steps')
  expect(await ui.find({ text: 'focus' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'toggle' })

  expect(seen).toEqual(['open', 'close'])
})

// The desktop footer draws nothing for a Client (a plain-text control with a
// hover-only fill), so the desktop keeps a Button. Button has no padding prop,
// so non-breaking spaces widen its pill.
test('the Steps button opens and closes the pane (desktop)', async ($, on) => {
  const seen = footer(on)
  const ui = await mountFooter($, 'desktop')

  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('  Steps  ')
  expect(await ui.find({ text: 'focus' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'toggle' })

  expect(seen).toEqual(['open', 'close'])
})

function pane(isOnScreen: boolean) {
  return { id: 'steps', title: 'Steps', isShown: isOnScreen, isFocused: false, isPlaced: isOnScreen }
}

// The rule sits in the system prompt, read once. Mid-turn nothing reminded Claude,
// so the pane showed a phase long finished. Tool results now carry a nudge.
const WORK = 'mcp__fake__search'

function answerWork(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('tool.call', { tool: WORK }, () => ({ result: 'ok' }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
}

async function work($: Parameters<Parameters<typeof test>[1]>[0], times: number, agentId?: string) {
  const out: (readonly string[])[] = []
  for (let i = 0; i < times; i++) {
    const r = await $.tool.call({ tool: WORK, ...(agentId ? { agentId } : {}) })
    out.push(r.context ?? [])
  }
  return out
}

test('a list left untouched for 6 tool calls gets a nudge that names the doing step', async ($, on) => {
  answerWork(on)
  await $.prompt.submit({ text: 'fix it' })
  await $.tool.call({ tool: TOOL, steps:[{ title: 'Open the issue', status: 'doing' }, { title: 'Run tests', status: 'todo' }] })

  const seen = await work($, 6)

  expect(seen.slice(0, 5).every(c => c.length === 0)).toBe(true)
  expect(seen[5].join('\n')).toContain('Open the issue')
})

test('a set_steps call starts the count again', async ($, on) => {
  answerWork(on)
  await $.prompt.submit({ text: 'fix it' })
  const list = [{ title: 'Open the issue', status: 'doing' }]
  await $.tool.call({ tool: TOOL, steps:list })
  const first = await work($, 5)
  await $.tool.call({ tool: TOOL, steps:list })
  const second = await work($, 5)

  expect([...first, ...second].every(c => c.length === 0)).toBe(true)
})

test('research with no list gets one nudge to make a plan', async ($, on) => {
  answerWork(on)
  await $.prompt.submit({ text: 'why is the build slow?' })

  const seen = await work($, 10)

  expect(seen.slice(0, 3).every(c => c.length === 0)).toBe(true)
  expect(seen[3].join('\n')).toContain(TOOL)
  expect(seen.slice(4).every(c => c.length === 0)).toBe(true)
})

test("a subagent's tool calls do not count", async ($, on) => {
  answerWork(on)
  await $.prompt.submit({ text: 'fix it' })
  await $.tool.call({ tool: TOOL, steps:[{ title: 'Open the issue', status: 'doing' }] })

  const seen = await work($, 10, 'agent-1')

  expect(seen.every(c => c.length === 0)).toBe(true)
})

test('the rule says research and investigation count as multi-step work', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [TOOL],
    outputStyle: null,
    traits: [],
  })

  expect(composed.sections.find(s => s.id === 'steps:rule')?.text).toMatch(/research/i)
})

function doingIcon(tree: unknown): { source?: string; isInteractive?: boolean } | undefined {
  const node = tree as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (node?.type === 'Svg' && node.props?.alt === 'doing') return node.props as { source?: string; isInteractive?: boolean }
  for (const child of [...(node?.children ?? []), ...((node?.props?.children as unknown[]) ?? [])].flat()) {
    const hit = doingIcon(child)
    if (hit) return hit
  }
  return undefined
}

// The sandboxed frame (isInteractive) painted a white square on the dark pane,
// even with color-scheme on the SVG root. The icon draws as a plain image, and a
// CSS animation inside the SVG turns it, with no redraws.
test('the doing icon is a plain image that turns by CSS, not a sandboxed frame', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
  await $.tool.call({ tool: TOOL, steps:[{ title: 'Build it', status: 'doing' }] })
  const ui = await mountDesktopPane($)
  const before = doingIcon(await ui.drawn())

  await clock.advance(1000)
  const after = doingIcon(await ui.drawn())

  expect(before?.isInteractive).not.toBe(true)
  expect(before?.source).toContain('@keyframes')
  expect(after?.source).toBe(before?.source)
})

// A plain turning circle, not the 12-spoke macOS spinner.
test('the doing icon is a turning circle, not spokes', async ($, on) => {
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
  await $.tool.call({ tool: TOOL, steps:[{ title: 'Build it', status: 'doing' }] })
  const ui = await mountDesktopPane($)

  const source = doingIcon(await ui.drawn())?.source ?? ''

  expect(source).toContain('<circle')
  expect(source).not.toContain('<line')
})

// The goal set with /goal shows above the list: a target symbol and "Goal" in bold,
// then the goal on its own line in regular weight, with its first letter raised.
type Found = { props: Record<string, unknown>; text: string }
type Pane = { find: (query: { type?: string; text?: string | RegExp }) => Promise<Found | undefined> }

// A string query matches by inclusion, so "Goal" alone would also find "Goal: Ship it".
const exactly = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

async function expectGoal(ui: Pane, text: string, label = 'Goal') {
  expect((await ui.find({ type: 'Text', text: exactly(label) }))?.props.bold).toBe(true)
  const shown = await ui.find({ type: 'Text', text: exactly(text) })
  expect(shown).toBeDefined()
  expect(shown?.props.bold).not.toBe(true)
}

async function expectNoGoal(ui: Pane) {
  expect(await ui.find({ type: 'Text', text: /^(◎ )?Goal$/ })).toBeUndefined()
}

function answerGoal(on: On) {
  on('command.run', { command: 'goal' }, () => ({ text: 'Goal set.' }))
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
}

function runGoal($: Engine, args: string) {
  return $.command.run({
    command: 'goal',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/goal shows as the title above the steps (${surface})`, async ($, on) => {
    answerGoal(on)
    await runGoal($, 'make sure all the tests pass and no regressions')
    await $.tool.call({ tool: TOOL, steps: [{ title: 'Run tests', status: 'doing' }] })
    const ui = await $.ui.mount({
      plugin: 'steps',
      surface,
      component: 'Pane',
      requestId: 'steps',
      props: { title: 'Steps', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })

    // The terminal has no icons, so its label carries the symbol as text.
    await expectGoal(ui, 'Make sure all the tests pass and no regressions', surface === 'terminal' ? '◎ Goal' : 'Goal')
    expect(await ui.find({ text: 'Run tests' })).toBeDefined()
  })
}

test('the goal label carries a target icon (desktop)', async ($, on) => {
  answerGoal(on)
  await runGoal($, 'ship it')
  const ui = await mountDesktopPane($)

  const icons = await ui.findAll({ type: 'Svg' })
  expect(icons.map(i => i.props.alt)).toContain('goal')
})

test('the goal shows before any step is set', async ($, on) => {
  answerGoal(on)
  await runGoal($, 'ship it')
  const ui = await mountDesktopPane($)

  await expectGoal(ui, 'Ship it')
  expect(await ui.find({ text: 'No steps yet.' })).toBeDefined()
})

test('/goal clear takes the goal away, and bare /goal keeps it', async ($, on) => {
  answerGoal(on)
  await runGoal($, 'ship it')
  const ui = await mountDesktopPane($)

  await runGoal($, '')
  await expectGoal(ui, 'Ship it')

  await runGoal($, 'clear')
  await expectNoGoal(ui)
  expect(await ui.find({ text: 'Ship it' })).toBeUndefined()
})

test('a goal Claude sets with ProposeGoal shows too', async ($, on) => {
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
  on('tool.call', { tool: 'ProposeGoal' }, (_$, e) => ({ result: { condition: e.condition, askUser: false } }) as never)
  await $.tool.call({ tool: 'ProposeGoal', condition: 'all tests in test/auth pass', ask_user: false } as never)
  const ui = await mountDesktopPane($)

  await expectGoal(ui, 'All tests in test/auth pass')
})

test('a ProposeGoal the person turns down sets no goal', async ($, on) => {
  on('ui.open', { id: 'steps' }, () => ({ value: { isPlaced: true as const } }))
  on('tool.call', { tool: 'ProposeGoal' }, () => ({ deny: 'The user declined the goal.' }))
  await $.tool.call({ tool: 'ProposeGoal', condition: 'all tests pass' } as never)
  const ui = await mountDesktopPane($)

  await expectNoGoal(ui)
})

function mountDesktopPane($: Parameters<Parameters<typeof test>[1]>[0]) {
  return $.ui.mount({
    plugin: 'steps',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'steps',
    props: { title: 'Steps', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } },
  })
}
