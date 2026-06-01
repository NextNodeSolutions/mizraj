import type { TaskStatus } from '../lib/tasks'

export const STATUS_CONFIG: Record<
	TaskStatus,
	{ label: string; marker: string }
> = {
	backlog: { label: 'Backlog', marker: '○' },
	in_progress: { label: 'In progress', marker: '◐' },
	done: { label: 'Done', marker: '✓' },
	blocked: { label: 'Blocked', marker: '⊘' },
}
