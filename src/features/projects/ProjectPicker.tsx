import { Fragment, useMemo, useState } from 'react'

import { matchMissionControlRoute, usePathname } from '@/app/router'
import { IconX } from '@/shared/ui/icons'

import { compactPath, projectName } from './repoPaths'
import { useListboxNavigation } from './useListboxNavigation'
import { useProjects } from './useProjects'

type Props = {
	activeProjectPath: string | null
	onSelect: (path: string) => void
}

type ScopeLabelProps = {
	activeProjectPath: string | null
	onMissionRoute: boolean
}

const ScopeLabel = ({
	activeProjectPath,
	onMissionRoute,
}: ScopeLabelProps): React.JSX.Element => {
	if (activeProjectPath === null) return <>Choose repo</>
	if (onMissionRoute) {
		return (
			<>
				<span>scope</span> <b>all projects</b>{' '}
				<span className="carat">▾</span>
			</>
		)
	}
	return (
		<>
			<span>repo</span> <b>{projectName(activeProjectPath)}</b>{' '}
			<span className="carat">▾</span>
		</>
	)
}

// A registered repo (present or vanished from disk), or the trailing
// "Add repo…" action. Vanished repos can only be pruned, never opened.
type MenuEntry =
	| { kind: 'project'; path: string; missing: boolean }
	| { kind: 'add' }

const ADD_ENTRY: MenuEntry = { kind: 'add' }

/**
 * Order the menu so present repos lead, the add action sits between, and
 * vanished repos trail under their own group. The fixed layout lets keyboard
 * nav index entries directly and the render place the "introuvable" header.
 */
const buildEntries = (
	projects: ReadonlyArray<string>,
	missing: ReadonlyArray<string>,
): ReadonlyArray<MenuEntry> => {
	const isGone = (path: string): boolean => missing.includes(path)
	const present = projects.filter(path => !isGone(path))
	const gone = projects.filter(isGone)
	return [
		...present.map(
			path => ({ kind: 'project', path, missing: false }) as const,
		),
		ADD_ENTRY,
		...gone.map(
			path => ({ kind: 'project', path, missing: true }) as const,
		),
	]
}

export const ProjectPicker = ({
	activeProjectPath,
	onSelect,
}: Props): React.JSX.Element => {
	const pathname = usePathname()
	const {
		projects,
		missing,
		addProjectViaDialog,
		removeProject,
		refreshMissing,
	} = useProjects()
	const [menuOpen, setMenuOpen] = useState(false)

	// Stable identity so the nav hook and clamp depend on a value that only
	// changes when the registry does, not on every hover-driven re-render.
	const entries = useMemo(
		() => buildEntries(projects, missing),
		[projects, missing],
	)
	const firstGoneIndex = useMemo(
		() =>
			entries.findIndex(
				entry => entry.kind === 'project' && entry.missing,
			),
		[entries],
	)

	const addRepoThenSwitch = (): void => {
		void addProjectViaDialog().then(canonical => {
			if (canonical !== null) onSelect(canonical)
		})
	}

	const choose = (entry: MenuEntry | undefined): void => {
		if (entry === undefined) return
		if (entry.kind === 'add') {
			setMenuOpen(false)
			addRepoThenSwitch()
			return
		}
		// A vanished repo has nothing to open — the row only offers removal.
		if (entry.missing) return
		setMenuOpen(false)
		onSelect(entry.path)
	}

	const prune = (path: string): void => {
		// removeProject re-renders a re-ordered, shorter list; useListboxNavigation
		// clamps the highlight in its layout effect keyed on entries.length.
		void removeProject(path)
	}

	const { highlighted, setHighlighted } = useListboxNavigation<MenuEntry>({
		entries,
		isOpen: menuOpen,
		onClose: () => setMenuOpen(false),
		onChoose: choose,
		onRemove: entry => {
			// Only registered repos are removable; the "Add repo…" row lets the
			// key fall through.
			if (entry.kind !== 'project') return false
			prune(entry.path)
			return true
		},
	})

	const openMenu = (): void => {
		const activeIndex = entries.findIndex(
			entry =>
				entry.kind === 'project' && entry.path === activeProjectPath,
		)
		setHighlighted(Math.max(activeIndex, 0))
		setMenuOpen(true)
		// A repo can vanish while the app runs; re-probe so the menu is truthful.
		void refreshMissing()
	}

	return (
		<div className="mz-projwrap">
			<button
				type="button"
				className="mz-proj"
				title={activeProjectPath ?? undefined}
				aria-haspopup="listbox"
				aria-expanded={menuOpen}
				onClick={() => {
					if (menuOpen) {
						setMenuOpen(false)
					} else {
						openMenu()
					}
				}}
			>
				<ScopeLabel
					activeProjectPath={activeProjectPath}
					onMissionRoute={matchMissionControlRoute(pathname)}
				/>
			</button>
			{menuOpen && (
				<ul
					className="mz-projmenu pal-list"
					role="listbox"
					aria-label="Repositories"
				>
					{entries.map((entry, index) => (
						<Fragment
							key={entry.kind === 'add' ? '__add__' : entry.path}
						>
							{index === firstGoneIndex && (
								<li className="pal-group" role="presentation">
									introuvable
								</li>
							)}
							<ProjectOption
								entry={entry}
								active={
									entry.kind === 'project' &&
									entry.path === activeProjectPath
								}
								highlighted={index === highlighted}
								onHover={() => setHighlighted(index)}
								onChoose={() => choose(entry)}
								onRemove={
									entry.kind === 'project'
										? () => prune(entry.path)
										: undefined
								}
							/>
						</Fragment>
					))}
				</ul>
			)}
		</div>
	)
}

type OptionProps = {
	entry: MenuEntry
	active: boolean
	highlighted: boolean
	onHover: () => void
	onChoose: () => void
	onRemove?: () => void
}

const ProjectOption = ({
	entry,
	active,
	highlighted,
	onHover,
	onChoose,
	onRemove,
}: OptionProps): React.JSX.Element => {
	if (entry.kind === 'add') {
		return (
			<li
				className="pal-item"
				role="option"
				aria-selected={false}
				data-on={highlighted ? 'true' : 'false'}
				onMouseEnter={onHover}
				onClick={onChoose}
			>
				<span>Add repo…</span>
			</li>
		)
	}
	return (
		<li
			className="pal-item"
			role="option"
			aria-selected={active}
			data-on={highlighted ? 'true' : 'false'}
			data-missing={entry.missing ? 'true' : 'false'}
			onMouseEnter={onHover}
			onClick={onChoose}
		>
			<span>{projectName(entry.path)}</span>
			<span className="pk">{compactPath(entry.path)}</span>
			{onRemove && (
				<button
					type="button"
					className="pal-rm"
					aria-label={`Remove ${projectName(entry.path)} from the pool`}
					onClick={event => {
						event.stopPropagation()
						onRemove()
					}}
				>
					<IconX />
				</button>
			)}
		</li>
	)
}
