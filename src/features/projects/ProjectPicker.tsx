import { open } from '@tauri-apps/plugin-dialog'
import { Fragment, useEffect, useState } from 'react'

import { matchMissionControlRoute, usePathname } from '@/app/router'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'
import { IconX } from '@/shared/ui/icons'

import { compactPath, projectName } from './repoPaths'
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
	const { projects, missing, addProject, removeProject, refreshMissing } =
		useProjects()
	const [menuOpen, setMenuOpen] = useState(false)
	const [highlighted, setHighlighted] = useState(0)

	const entries = buildEntries(projects, missing)
	const firstGoneIndex = entries.findIndex(
		entry => entry.kind === 'project' && entry.missing,
	)

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

	const addRepoThenSwitch = (): void => {
		open({ directory: true })
			.then(async selected => {
				if (selected === null) return
				const canonical = await addProject(selected)
				if (canonical !== null) onSelect(canonical)
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`ProjectPicker: open dialog failed: ${message}`, {
					scope: 'project-picker',
					details: { stack },
				})
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
		void removeProject(path)
		// The pruned repo leaves the list, so the highlight can't outrun its end.
		const remainingCount = entries.length - 1
		setHighlighted(current =>
			Math.max(0, Math.min(current, remainingCount - 1)),
		)
	}

	// The menu owns its keys at the window's capture phase, like the palette,
	// so the embedded terminal never sees a handled chord.
	useEffect(() => {
		if (!menuOpen) return
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				setMenuOpen(false)
				return
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				event.stopPropagation()
				const step = event.key === 'ArrowDown' ? 1 : -1
				setHighlighted(current =>
					Math.max(0, Math.min(current + step, entries.length - 1)),
				)
				return
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				const entry = entries[highlighted]
				if (entry?.kind !== 'project') return
				event.preventDefault()
				event.stopPropagation()
				prune(entry.path)
				return
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				event.stopPropagation()
				choose(entries[highlighted])
			}
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, { capture: true })
	})

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
