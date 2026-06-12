import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'

import { usePlans } from '@/features/plans/plans'
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
}: Props): React.JSX.Element | null => {
	const [open, setOpen] = useAtom(paletteOpenAtom)
	const sessions = useSessions()
	const plansState = usePlans(activeProjectPath)
	const [query, setQuery] = useState('')
	const [selection, setSelection] = useState(0)

	const plans = plansState.status === 'ready' ? plansState.data : []
	const items = buildPaletteItems({ sessions, plans, activeProjectPath })
	const filtered = filterPaletteItems(items, query)
	const selected = Math.min(selection, Math.max(0, filtered.length - 1))

	const close = (): void => {
		setOpen(false)
		setQuery('')
		setSelection(0)
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
				setOpen(current => !current)
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
					Math.max(
						0,
						Math.min(current + step, filtered.length - 1),
					),
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

	if (!open) return null

	return (
		<>
			<div
				className="palette-backdrop"
				role="presentation"
				onClick={close}
			/>
			<div className="palette" role="dialog" aria-label="Command palette">
				<input
					autoFocus
					type="text"
					value={query}
					placeholder="Search agents, plans, screens…"
					onChange={event => {
						setQuery(event.target.value)
						setSelection(0)
					}}
				/>
				{filtered.length === 0 ? (
					<p className="palette__empty">No matches.</p>
				) : (
					<ul role="listbox" aria-label="Results">
						{filtered.map((item, index) => (
							<PaletteRow
								key={`${item.group}:${item.label}`}
								item={item}
								previous={filtered[index - 1]}
								active={index === selected}
								onRun={run}
							/>
						))}
					</ul>
				)}
			</div>
		</>
	)
}

type RowProps = {
	item: PaletteItem
	previous: PaletteItem | undefined
	active: boolean
	onRun: (item: PaletteItem) => void
}

const PaletteRow = ({
	item,
	previous,
	active,
	onRun,
}: RowProps): React.JSX.Element => (
	<>
		{item.group !== previous?.group && (
			<div className="palette__group" role="presentation">
				{item.group}
			</div>
		)}
		<li
			role="option"
			aria-selected={active}
			onClick={() => onRun(item)}
		>
			{item.label}
			{item.hint !== undefined && (
				<span className="palette__hint">{item.hint}</span>
			)}
		</li>
	</>
)
