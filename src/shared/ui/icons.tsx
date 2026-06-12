/**
 * Shared v2 icon set — simple 18x18 stroke glyphs, geometry ported verbatim
 * from the design system. Sized by the consuming CSS (.mz-railbtn svg, …).
 */

const STROKE_WIDTH = 1.6
const PLUS_STROKE_WIDTH = 1.8

type IconCanvasProps = {
	strokeWidth?: number
	children: React.ReactNode
}

const IconCanvas = ({
	strokeWidth = STROKE_WIDTH,
	children,
}: IconCanvasProps): React.JSX.Element => (
	<svg
		viewBox="0 0 18 18"
		fill="none"
		stroke="currentColor"
		strokeWidth={strokeWidth}
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		{children}
	</svg>
)

export const IconGrid = (): React.JSX.Element => (
	<IconCanvas>
		<rect x="2" y="2" width="6" height="6" rx="1.5" />
		<rect x="10" y="2" width="6" height="6" rx="1.5" />
		<rect x="2" y="10" width="6" height="6" rx="1.5" />
		<rect x="10" y="10" width="6" height="6" rx="1.5" />
	</IconCanvas>
)

export const IconTerm = (): React.JSX.Element => (
	<IconCanvas>
		<rect x="1.5" y="2.5" width="15" height="13" rx="2" />
		<polyline points="5,7 7.5,9.5 5,12" />
		<line x1="9.5" y1="12" x2="13" y2="12" />
	</IconCanvas>
)

export const IconBoard = (): React.JSX.Element => (
	<IconCanvas>
		<rect x="2" y="2.5" width="4" height="13" rx="1.2" />
		<rect x="7" y="2.5" width="4" height="9" rx="1.2" />
		<rect x="12" y="2.5" width="4" height="6" rx="1.2" />
	</IconCanvas>
)

export const IconDoc = (): React.JSX.Element => (
	<IconCanvas>
		<rect x="3" y="1.5" width="12" height="15" rx="2" />
		<line x1="6" y1="6" x2="12" y2="6" />
		<line x1="6" y1="9" x2="12" y2="9" />
		<line x1="6" y1="12" x2="9.5" y2="12" />
	</IconCanvas>
)

export const IconDiff = (): React.JSX.Element => (
	<IconCanvas>
		<line x1="5" y1="3" x2="5" y2="9" />
		<line x1="2" y1="6" x2="8" y2="6" />
		<line x1="10" y1="13" x2="16" y2="13" />
		<circle cx="5" cy="14" r="1.4" />
		<circle cx="13" cy="4.5" r="1.4" />
	</IconCanvas>
)

export const IconGear = (): React.JSX.Element => (
	<IconCanvas>
		<circle cx="9" cy="9" r="3" />
		<line x1="9" y1="1.5" x2="9" y2="4" />
		<line x1="9" y1="14" x2="9" y2="16.5" />
		<line x1="1.5" y1="9" x2="4" y2="9" />
		<line x1="14" y1="9" x2="16.5" y2="9" />
		<line x1="3.7" y1="3.7" x2="5.5" y2="5.5" />
		<line x1="12.5" y1="12.5" x2="14.3" y2="14.3" />
		<line x1="3.7" y1="14.3" x2="5.5" y2="12.5" />
		<line x1="12.5" y1="5.5" x2="14.3" y2="3.7" />
	</IconCanvas>
)

export const IconPlus = (): React.JSX.Element => (
	<IconCanvas strokeWidth={PLUS_STROKE_WIDTH}>
		<line x1="9" y1="3.5" x2="9" y2="14.5" />
		<line x1="3.5" y1="9" x2="14.5" y2="9" />
	</IconCanvas>
)
