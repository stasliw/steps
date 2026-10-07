export type StepStatus = 'todo' | 'doing' | 'done'
export type Step = { title: string; status: StepStatus }

declare module 'claude-code' {
  interface PluginState {
    steps: { steps: Step[] }
  }
}
