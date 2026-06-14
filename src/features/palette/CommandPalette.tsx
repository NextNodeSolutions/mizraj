import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useId, useRef, useState } from 'react'

import { usePlans } from '@/features/plans/plans'
import { activeSessionIdAtom } from '@/features/sessions/sessions'
import { useSessions } from '@/features/sessions/useSessions'

import { paletteOpenAtom } from './palette'
import type { PaletteItem } from './paletteItems'
import { buildPaletteItems, filterPaletteItems } from './paletteItems'
import { usePaletteKeyboard } from './usePaletteKeyboard'

type Props = {
	activeProjectPath: string | null
}

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
	// One stable base for the listbox + its options, so the input's
	// aria-activedescendant can name the highlighted row for a screen reader.
	const baseId = useId()
	const listboxId = `${baseId}-listbox`
	const optionId = (index: number): string => `${baseId}-opt-${index}`

	const plans = plansState.status === 'ready' ? plansState.data : []
	const items = buildPaletteItems({
		sessions,
		plans,
		activeProjectPath,
		activeSessionId,
	})
	const filtered = filterPaletteItems(items, query)
	const selected = Math.min(selection, Math.max(0, filtered.length - 1))
	const activeOptionId = filtered.length > 0 ? optionId(selected) : undefined

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

	usePaletteKeyboard({
		open,
		openPalette: () => setOpen(true),
		close,
		focusInput: () => inputRef.current?.focus(),
		moveSelection: step =>
			setSelection(current =>
				Math.max(0, Math.min(current + step, filtered.length - 1)),
			),
		runSelected: () => run(filtered[selected]),
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
				// Closed-but-mounted: take the whole dialog out of the tab order
				// and the accessibility tree until it is summoned.
				inert={!open}
			>
				<input
					ref={inputRef}
					type="text"
					value={query}
					placeholder="Search agents, plans, actions…"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-activedescendant={activeOptionId}
					aria-autocomplete="list"
					onChange={event => {
						setQuery(event.target.value)
						setSelection(0)
					}}
				/>
				<ul
					id={listboxId}
					className="pal-list"
					role="listbox"
					aria-label="Results"
				>
					{filtered.length === 0 && (
						<li className="pal-empty" role="presentation">
							no results for “{query}”
						</li>
					)}
					{filtered.map((item, index) => (
						<PaletteRow
							key={item.id}
							item={item}
							previous={filtered[index - 1]}
							optionId={optionId(index)}
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
	optionId: string
	active: boolean
	onHover: () => void
	onRun: (item: PaletteItem) => void
}

const PaletteRow = ({
	item,
	previous,
	optionId,
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
			id={optionId}
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
