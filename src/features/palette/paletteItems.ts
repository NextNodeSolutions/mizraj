import {
	agentRunHref,
	missionControlHref,
	navigate,
	pipelineHref,
	planRouteHref,
	plansIndexHref,
	reviewHref,
	tasksHref,
} from '@/app/router'
import type { PlanEntry } from '@/features/plans/plans'
import {
	DISPLAY_STATUS_LABEL,
	sessionDisplayStatus,
} from '@/features/sessions/displayStatus'
import {
	launchSession,
	launchShellSession,
} from '@/features/sessions/launchSession'
import { sessionLabel } from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'

export type PaletteItem = {
	group: string
	label: string
	hint?: string
	run: () => void
}

const AGENT_BINARY = 'claude'

type BuildArgs = {
	sessions: ReadonlyArray<SessionState>
	plans: ReadonlyArray<PlanEntry>
	activeProjectPath: string | null
}

const screenItems = (): ReadonlyArray<PaletteItem> => [
	{
		group: 'Go to',
		label: 'Mission Control',
		hint: 'A',
		run: () => navigate(missionControlHref()),
	},
	{
		group: 'Go to',
		label: 'Pipeline',
		hint: 'C',
		run: () => navigate(pipelineHref()),
	},
	{
		group: 'Go to',
		label: 'Plans',
		hint: 'D',
		run: () => navigate(plansIndexHref()),
	},
	{ group: 'Go to', label: 'Tasks', run: () => navigate(tasksHref()) },
	{
		group: 'Go to',
		label: 'Diff review',
		hint: 'E',
		run: () => navigate(reviewHref()),
	},
]

const sessionItems = (
	sessions: ReadonlyArray<SessionState>,
): ReadonlyArray<PaletteItem> =>
	sessions.map(session => ({
		group: 'Agents',
		label: sessionLabel(session),
		hint: DISPLAY_STATUS_LABEL[sessionDisplayStatus(session)],
		run: () => navigate(agentRunHref(session.id)),
	}))

const planItems = (
	plans: ReadonlyArray<PlanEntry>,
): ReadonlyArray<PaletteItem> =>
	plans.map(entry => ({
		group: 'Plans',
		label: entry.title,
		hint: entry.kind,
		run: () => navigate(planRouteHref(entry)),
	}))

const actionItems = (
	activeProjectPath: string | null,
): ReadonlyArray<PaletteItem> => {
	if (activeProjectPath === null) return []
	return [
		{
			group: 'Actions',
			label: 'New agent',
			run: () => {
				void launchSession({
					binary: AGENT_BINARY,
					repoPath: activeProjectPath,
				})
			},
		},
		{
			group: 'Actions',
			label: 'New terminal',
			run: () => {
				void launchShellSession(activeProjectPath)
			},
		},
	]
}

/**
 * Everything ⌘K can reach, grouped: screens, live sessions, plan documents
 * and launch actions (the latter only when a project is active).
 */
export const buildPaletteItems = ({
	sessions,
	plans,
	activeProjectPath,
}: BuildArgs): ReadonlyArray<PaletteItem> => [
	...screenItems(),
	...sessionItems(sessions),
	...planItems(plans),
	...actionItems(activeProjectPath),
]

export const filterPaletteItems = (
	items: ReadonlyArray<PaletteItem>,
	query: string,
): ReadonlyArray<PaletteItem> => {
	const needle = query.trim().toLowerCase()
	if (needle === '') return items
	return items.filter(item =>
		`${item.group} ${item.label}`.toLowerCase().includes(needle),
	)
}
