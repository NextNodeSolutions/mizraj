import { useState } from 'react'

export type DiffLayout = 'split' | 'stacked'
export type DiffStyle = 'split' | 'unified'

const DIFF_STYLE_BY_LAYOUT: Record<DiffLayout, DiffStyle> = {
	split: 'split',
	stacked: 'unified',
}

type LayoutToggle = {
	layout: DiffLayout
	toggleLayout: () => void
	diffStyle: DiffStyle
}

export const useLayoutToggle = (
	initial: DiffLayout = 'split',
): LayoutToggle => {
	const [layout, setLayout] = useState<DiffLayout>(initial)
	const toggleLayout = (): void => {
		setLayout(prev => (prev === 'split' ? 'stacked' : 'split'))
	}
	return { layout, toggleLayout, diffStyle: DIFF_STYLE_BY_LAYOUT[layout] }
}
