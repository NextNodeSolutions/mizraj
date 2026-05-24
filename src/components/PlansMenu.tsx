import type { PlanEntry, PlanKind, PlansState } from '../lib/plans'
import { usePlans } from '../lib/plans'
import { navigate, planRouteHref } from '../router'

const SECTIONS: ReadonlyArray<{ title: string; kind: PlanKind }> = [
	{ title: 'Interviews', kind: 'interview' },
	{ title: 'Plans', kind: 'plan' },
]

const defaultSelect = (entry: PlanEntry): void => {
	navigate(planRouteHref(entry))
}

type Props = {
	repoPath: string | null
	onSelect?: (entry: PlanEntry) => void
}

type SectionProps = {
	title: string
	entries: ReadonlyArray<PlanEntry>
	onSelect: (entry: PlanEntry) => void
}

const PlansMenuSection = ({
	title,
	entries,
	onSelect,
}: SectionProps): React.JSX.Element => (
	<section className="plans-menu__section">
		<h3 className="plans-menu__heading">{title}</h3>
		{entries.length === 0 ? (
			<p className="plans-menu__empty">None yet.</p>
		) : (
			<ul className="plans-menu__list">
				{entries.map(entry => (
					<li key={`${entry.kind}:${entry.slug}`}>
						<a
							className="plans-menu__link"
							href={planRouteHref(entry)}
							onClick={event => {
								event.preventDefault()
								onSelect(entry)
							}}
							title={entry.slug}
						>
							{entry.title}
						</a>
					</li>
				))}
			</ul>
		)}
	</section>
)

const renderState = (
	state: PlansState,
	onSelect: (entry: PlanEntry) => void,
): React.JSX.Element => {
	if (state.status === 'idle') {
		return <p className="plans-menu__empty">No project selected.</p>
	}
	if (state.status === 'loading') {
		return <p className="plans-menu__empty">Loading…</p>
	}
	if (state.status === 'error') {
		return <p className="plans-menu__empty">Failed to load plans.</p>
	}
	return (
		<>
			{SECTIONS.map(section => (
				<PlansMenuSection
					key={section.kind}
					title={section.title}
					entries={state.entries.filter(
						entry => entry.kind === section.kind,
					)}
					onSelect={onSelect}
				/>
			))}
		</>
	)
}

const PlansMenu = ({ repoPath, onSelect }: Props): React.JSX.Element => {
	const state = usePlans(repoPath)
	const handleSelect = onSelect ?? defaultSelect
	return (
		<nav className="plans-menu" aria-label="Plans">
			{renderState(state, handleSelect)}
		</nav>
	)
}

export default PlansMenu
