import { navigate, planRouteHref, usePathname } from '@/app/router'
import { IconDoc } from '@/shared/ui/icons'

import type { PlanEntry, PlanKind, PlansState } from './plans'
import { updatedLabel } from './updatedLabel'

const SECTIONS: ReadonlyArray<{ title: string; kind: PlanKind }> = [
	{ title: 'Plans', kind: 'plan' },
	{ title: 'Interviews', kind: 'interview' },
]

const defaultSelect = (entry: PlanEntry): void => {
	navigate(planRouteHref(entry))
}

type Props = {
	state: PlansState
	nowMs: number
	onSelect?: (entry: PlanEntry) => void
}

type RowProps = {
	entry: PlanEntry
	nowMs: number
	onSelect: (entry: PlanEntry) => void
}

const PlanRow = ({ entry, nowMs, onSelect }: RowProps): React.JSX.Element => {
	const pathname = usePathname()
	return (
		<a
			className="lrow"
			href={planRouteHref(entry)}
			aria-current={
				planRouteHref(entry) === pathname ? 'page' : undefined
			}
			onClick={event => {
				event.preventDefault()
				onSelect(entry)
			}}
			title={entry.slug}
		>
			{entry.kind === 'plan' ? (
				<span className="pl-glyph">
					<IconDoc />
				</span>
			) : (
				<span className="pl-glyph pl-glyph-pen">✎</span>
			)}
			<span className="pl-row-text">
				<span className="lr-t">{entry.title}</span>
				{/* TODO: interview question count — read_interview_state(slug) returns untyped state.json (phase, rounds_completed); no qa/question count guaranteed */}
				<span className="lr-b">{updatedLabel(nowMs, entry.mtime)}</span>
			</span>
		</a>
	)
}

type SectionProps = {
	title: string
	entries: ReadonlyArray<PlanEntry>
	nowMs: number
	onSelect: (entry: PlanEntry) => void
}

const PlansMenuSection = ({
	title,
	entries,
	nowMs,
	onSelect,
}: SectionProps): React.JSX.Element => (
	<>
		<div className="lgroup">{title}</div>
		{entries.length === 0 ? (
			<p className="pl-empty">None yet.</p>
		) : (
			entries.map(entry => (
				<PlanRow
					key={`${entry.kind}:${entry.slug}`}
					entry={entry}
					nowMs={nowMs}
					onSelect={onSelect}
				/>
			))
		)}
	</>
)

const renderState = (
	state: PlansState,
	nowMs: number,
	onSelect: (entry: PlanEntry) => void,
): React.JSX.Element => {
	if (state.status === 'idle') {
		return <p className="pl-empty">No project selected.</p>
	}
	if (state.status === 'loading') {
		return <p className="pl-empty">Loading…</p>
	}
	if (state.status === 'error') {
		return <p className="pl-empty">Failed to load plans.</p>
	}
	return (
		<>
			{SECTIONS.map(section => (
				<PlansMenuSection
					key={section.kind}
					title={section.title}
					entries={state.data.filter(
						entry => entry.kind === section.kind,
					)}
					nowMs={nowMs}
					onSelect={onSelect}
				/>
			))}
		</>
	)
}

export const PlansMenu = ({
	state,
	nowMs,
	onSelect,
}: Props): React.JSX.Element => (
	<nav className="pl-list" aria-label="Plans and interviews">
		{renderState(state, nowMs, onSelect ?? defaultSelect)}
	</nav>
)
