export type TaskStatus = 'todo' | 'doing' | 'done'
export type Task = { title: string; status: TaskStatus }

declare module 'claude-code' {
  interface PluginState {
    'task-list': { tasks: Task[] }
  }
}
