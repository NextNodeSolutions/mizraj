import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import { usePlans } from '@/features/plans/plans'
import { activeSessionIdAtom } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'

import { paletteOpenAtom } from './palette'
import type { PaletteItem } from './paletteItems'
import { buildPaletteItems, filterPaletteItems } from './paletteItems'

type Props = {
	activeProjectPath: string | null
}

const isToggleChord = (event: KeyboardEvent): boolean =>
	(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'

export const CommandPalette = ({
	activeProjectPath,
}: Props): React.JSX.Element => {
	const [open, setOpen] = useAtom(paletteOpenAtom)
	const sessions = useSessions()
	const activeSessionId = useAtomValue(activeSessionIdAtom)
	const plansState = usePlans(activeProjectPath)
	const [query, setQuery] = useState('')
	const [selection, setSelection] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)

	const plans = plansState.status === 'ready' ? plansState.data : []
	const items = buildPaletteItems({
		sessions,
		plans,
		activeProjectPath,
		activeSessionId,
	})
	const filtered = filterPaletteItems(items, query)
	const selected = Math.min(selection, Math.max(0, filtered.length - 1))

	const close = (): void => {
		setOpen(false)
		setQuery('')
		setSelection(0)
		// The component stays mounted: hand the keyboard back so the hidden
		// input never swallows keystrokes meant for the terminal.
		inputRef.current?.blur()
	}

	const run = (item: PaletteItem | undefined): void => {
		if (!item) return
		close()
		item.run()
	}

	// The palette owns its shortcuts at the window's capture phase so the
	// terminal's own window-level key router (and any Ghostty cmd+K binding)
	// never sees a handled chord.
	useEffect(() => {
		const onKeydown = (event: KeyboardEvent): void => {
			if (isToggleChord(event)) {
				event.preventDefault()
				event.stopPropagation()
				if (open) {
					close()
				} else {
					setOpen(true)
				}
				return
			}
			if (!open) return
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				close()
				return
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				event.stopPropagation()
				const step = event.key === 'ArrowDown' ? 1 : -1
				setSelection(current =>
					Math.max(0, Math.min(current + step, filtered.length - 1)),
				)
				return
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				event.stopPropagation()
				run(filtered[selected])
			}
		}
		window.addEventListener('keydown', onKeydown, { capture: true })
		return () =>
			window.removeEventListener('keydown', onKeydown, {
				capture: true,
			})
	})

	// Mounted-but-hidden component (the data-open transition needs a live
	// element): focus is the one thing that must follow the open state.
	useEffect(() => {
		if (open) inputRef.current?.focus()
	}, [open])

	const openAttr = open ? 'true' : 'false'

	return (
		<>
			<div
				className="pal-back"
				data-open={openAttr}
				role="presentation"
				onClick={close}
			/>
			<div
				className="palette"
				data-open={openAttr}
				role="dialog"
				aria-label="Command palette"
			>
				<input
					ref={inputRef}
					type="text"
					value={query}
					placeholder="Search agents, plans, actions…"
					onChange={event => {
						setQuery(event.target.value)
						setSelection(0)
					}}
				/>
				<ul className="pal-list" role="listbox" aria-label="Results">
					{filtered.length === 0 && (
						<li className="pal-empty" role="presentation">
							no results for “{query}”
						</li>
					)}
					{filtered.map((item, index) => (
						<PaletteRow
							key={`${item.group}:${item.label}`}
							item={item}
							previous={filtered[index - 1]}
							active={index === selected}
							onHover={() => setSelection(index)}
							onRun={run}
						/>
					))}
				</ul>
			</div>
		</>
	)
}

type RowProps = {
	item: PaletteItem
	previous: PaletteItem | undefined
	active: boolean
	onHover: () => void
	onRun: (item: PaletteItem) => void
}

const PaletteRow = ({
	item,
	previous,
	active,
	onHover,
	onRun,
}: RowProps): React.JSX.Element => (
	<>
		{item.group !== previous?.group && (
			<li className="pal-group" role="presentation">
				{item.group}
			</li>
		)}
		<li
			className="pal-item"
			role="option"
			aria-selected={active}
			data-on={active ? 'true' : 'false'}
			onMouseEnter={onHover}
			onClick={() => onRun(item)}
		>
			<span>{item.label}</span>
			{item.hint !== undefined && <span className="pk">{item.hint}</span>}
		</li>
	</>
)
