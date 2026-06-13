import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'

import { matchMissionControlRoute, usePathname } from '@/app/router'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

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

const ADD_REPO = Symbol('add-repo')

type MenuEntry = string | typeof ADD_REPO

export const ProjectPicker = ({
	activeProjectPath,
	onSelect,
}: Props): React.JSX.Element => {
	const pathname = usePathname()
	const { projects, addProject } = useProjects()
	const [menuOpen, setMenuOpen] = useState(false)
	const [highlighted, setHighlighted] = useState(0)

	const entries: ReadonlyArray<MenuEntry> = [...projects, ADD_REPO]

	const openMenu = (): void => {
		const activeIndex = projects.findIndex(
			path => path === activeProjectPath,
		)
		setHighlighted(Math.max(activeIndex, 0))
		setMenuOpen(true)
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
		setMenuOpen(false)
		if (entry === ADD_REPO) {
			addRepoThenSwitch()
			return
		}
		onSelect(entry)
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
						<ProjectOption
							key={entry === ADD_REPO ? '__add__' : entry}
							entry={entry}
							active={entry === activeProjectPath}
							highlighted={index === highlighted}
							onHover={() => setHighlighted(index)}
							onChoose={choose}
						/>
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
	onChoose: (entry: MenuEntry) => void
}

const ProjectOption = ({
	entry,
	active,
	highlighted,
	onHover,
	onChoose,
}: OptionProps): React.JSX.Element => (
	<li
		className="pal-item"
		role="option"
		aria-selected={active}
		data-on={highlighted ? 'true' : 'false'}
		onMouseEnter={onHover}
		onClick={() => onChoose(entry)}
	>
		{entry === ADD_REPO ? (
			<span>Add repo…</span>
		) : (
			<>
				<span>{projectName(entry)}</span>
				<span className="pk">{compactPath(entry)}</span>
			</>
		)}
	</li>
)
