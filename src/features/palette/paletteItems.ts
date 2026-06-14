import {
	missionControlHref,
	navigate,
	pipelineHref,
	planRouteHref,
	plansIndexHref,
	reviewHref,
	tasksHref,
} from '@/app/router'
import type { PlanEntry } from '@/features/plans/plans'
import { cockpitTargetHref } from '@/features/sessions/cockpitTarget'
import {
	DISPLAY_STATUS_LABEL,
	sessionDisplayStatus,
} from '@/features/sessions/displayStatus'
import {
	launchSession,
	launchShellSession,
} from '@/features/sessions/launchSession'
import {
	openSession,
	openSessionReview,
} from '@/features/sessions/openSession'
import {
	sessionLabel,
	sessionRepoLabel,
} from '@/features/sessions/sessionLabel'
import type { SessionState } from '@/features/sessions/sessions'

export type PaletteItem = {
	/** Stable, unique React key — two sessions can share a label, never an id. */
	id: string
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
	activeSessionId: string | null
}

const sessionItems = (
	sessions: ReadonlyArray<SessionState>,
): ReadonlyArray<PaletteItem> =>
	sessions.map(session => {
		const repo = sessionRepoLabel(session)
		return {
			id: `agent:${session.id}`,
			group: 'Agents',
			label:
				repo === null
					? sessionLabel(session)
					: `${sessionLabel(session)} — ${repo}`,
			hint: DISPLAY_STATUS_LABEL[sessionDisplayStatus(session)],
			run: () => openSession(session),
		}
	})

// TODO(review-branches): list real reviewable branches instead of
// ended-clean sessions once get_diff takes a branch/worktree argument.
const reviewItems = (
	sessions: ReadonlyArray<SessionState>,
): ReadonlyArray<PaletteItem> =>
	sessions
		.filter(session => sessionDisplayStatus(session) === 'review')
		.map(session => ({
			id: `review:${session.id}`,
			group: 'Review',
			label: `${sessionLabel(session)} — needs review`,
			run: () => navigate(reviewHref()),
		}))

const planItems = (
	plans: ReadonlyArray<PlanEntry>,
): ReadonlyArray<PaletteItem> =>
	plans.map(entry => ({
		id: `plan:${entry.kind}:${entry.slug}`,
		group: 'Plans',
		label: entry.title,
		hint: entry.kind,
		run: () => navigate(planRouteHref(entry)),
	}))

const screenItems = (cockpitHref: string): ReadonlyArray<PaletteItem> => [
	{
		id: 'screen:mission-control',
		group: 'Go to',
		label: 'Mission Control',
		hint: '⌘1',
		run: () => navigate(missionControlHref()),
	},
	{
		id: 'screen:cockpit',
		group: 'Go to',
		label: 'Cockpit',
		hint: '⌘2',
		run: () => navigate(cockpitHref),
	},
	{
		id: 'screen:pipeline',
		group: 'Go to',
		label: 'Pipeline board',
		hint: '⌘3',
		run: () => navigate(pipelineHref()),
	},
	{
		id: 'screen:plans',
		group: 'Go to',
		label: 'Plans',
		hint: '⌘4',
		run: () => navigate(plansIndexHref()),
	},
	{
		id: 'screen:review',
		group: 'Go to',
		label: 'Diff review',
		hint: '⌘5',
		run: () => navigate(reviewHref()),
	},
	{
		id: 'screen:tasks',
		group: 'Go to',
		label: 'Tasks',
		run: () => navigate(tasksHref()),
	},
]

const actionItems = (
	activeProjectPath: string | null,
): ReadonlyArray<PaletteItem> => {
	if (activeProjectPath === null) return []
	return [
		{
			id: 'action:new-agent',
			group: 'Actions',
			label: 'New agent…',
			hint: '↵',
			run: () => {
				void launchSession({
					binary: AGENT_BINARY,
					repoPath: activeProjectPath,
				})
			},
		},
		{
			id: 'action:new-terminal',
			group: 'Actions',
			label: 'New terminal',
			run: () => {
				void launchShellSession(activeProjectPath)
			},
		},
	]
}

/**
 * Everything ⌘K can reach, grouped in the design's order: live sessions,
 * sessions awaiting review, plan documents, screens, then launch actions
 * (the latter only when a project is active).
 */
export const buildPaletteItems = ({
	sessions,
	plans,
	activeProjectPath,
	activeSessionId,
}: BuildArgs): ReadonlyArray<PaletteItem> => [
	...sessionItems(sessions),
	...reviewItems(sessions),
	...planItems(plans),
	...screenItems(cockpitTargetHref(sessions, activeSessionId)),
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
