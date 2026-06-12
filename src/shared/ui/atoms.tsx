/**
 * Shared v2 atoms — the smallest design-system pieces (status dots, tags,
 * diff stats, panels). Styling lives in src/app/styles/components.css.
 */
import type { SessionDisplayStatus } from '@/features/sessions/displayStatus'
import { DISPLAY_STATUS_LABEL } from '@/features/sessions/displayStatus'

/** The four states a status dot can show (see .sdot-* in components.css). */
export type SDotKind = 'run' | 'rev' | 'done' | 'fail'

type SDotProps = {
	s: SDotKind
}

export const SDot = ({ s }: SDotProps): React.JSX.Element => (
	<span className={`sdot sdot-${s}`} />
)

const TAG_CLASS: Readonly<Record<SessionDisplayStatus, string>> = {
	running: 'tag tag-run',
	review: 'tag tag-rev',
	failed: 'tag tag-fail',
}

type StatusTagProps = {
	status: SessionDisplayStatus
}

export const StatusTag = ({ status }: StatusTagProps): React.JSX.Element => (
	<span className={TAG_CLASS[status]}>{DISPLAY_STATUS_LABEL[status]}</span>
)

type DiffStatProps = {
	add: number
	del: number
	files?: number
}

export const DiffStat = ({
	add,
	del,
	files,
}: DiffStatProps): React.JSX.Element => (
	<span className="stat">
		<span className="add">+{add}</span>
		{del > 0 && ' '}
		{del > 0 && <span className="del">−{del}</span>}
		{files !== undefined && <span> · {files} files</span>}
	</span>
)

type PanelProps = {
	className?: string
	style?: React.CSSProperties
	children: React.ReactNode
}

export const Panel = ({
	className,
	style,
	children,
}: PanelProps): React.JSX.Element => (
	<section
		className={className === undefined ? 'panel' : `panel ${className}`}
		style={style}
	>
		{children}
	</section>
)

type PanelHeadProps = {
	title: string
	count?: number | string
	children?: React.ReactNode
}

// The design's .grip drag handle is omitted: decorative only, no behavior.
export const PanelHead = ({
	title,
	count,
	children,
}: PanelHeadProps): React.JSX.Element => (
	<header className="panel-head">
		<h3>{title}</h3>
		{count !== undefined && <span className="ph-count">{count}</span>}
		<span className="mz-spacer" />
		{children}
	</header>
)
