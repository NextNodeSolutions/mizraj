import { useEffect, useRef, useState } from 'react'

import { IconTerm } from '@/shared/ui/icons'

import { launchSession, launchShellSession } from './launchSession'

// TODO(agent-plugins): the agent list is hardcoded to Claude; read it from
// a plugin registry (~/.mizraj/agents) when the backend exposes one.
type AgentEntry = {
	id: string
	name: string
	description: string
	dotColor: string
	isDefault: boolean
}

const AGENTS: ReadonlyArray<AgentEntry> = [
	{
		id: 'claude',
		name: 'Claude',
		description: 'code agent',
		dotColor: 'var(--ctp-peach)',
		isDefault: true,
	},
]

type Props = {
	repoPath: string
}

/**
 * The topbar's split launch button: the primary action opens a plain
 * terminal in the active repo; the chevron lists the agents to run.
 */
export const SplitNew = ({ repoPath }: Props): React.JSX.Element => {
	const [pending, setPending] = useState(false)
	const [open, setOpen] = useState(false)
	const wrapRef = useRef<HTMLDivElement>(null)

	// While the menu is open, the document dismisses it: a mousedown outside
	// the wrapper or an Escape anywhere — the dropdown contract.
	useEffect(() => {
		if (!open) return
		const onDocumentMousedown = (event: MouseEvent): void => {
			const target = event.target
			if (target instanceof Node && wrapRef.current?.contains(target)) {
				return
			}
			setOpen(false)
		}
		const onDocumentKeydown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setOpen(false)
		}
		document.addEventListener('mousedown', onDocumentMousedown)
		document.addEventListener('keydown', onDocumentKeydown)
		return () => {
			document.removeEventListener('mousedown', onDocumentMousedown)
			document.removeEventListener('keydown', onDocumentKeydown)
		}
	}, [open])

	const handleTerminal = (): void => {
		setOpen(false)
		setPending(true)
		void launchShellSession(repoPath).finally(() => {
			setPending(false)
		})
	}

	const handleAgent = (binary: string): void => {
		setOpen(false)
		void launchSession({ binary, repoPath })
	}

	return (
		<div className="mz-split-wrap" ref={wrapRef}>
			<div className="mz-split">
				<button
					type="button"
					className="btn btn-primary mz-split-main"
					onClick={handleTerminal}
					disabled={pending}
					aria-busy={pending}
				>
					<IconTerm /> {pending ? 'Opening…' : 'New terminal'}
				</button>
				<button
					type="button"
					className="btn btn-primary mz-split-chev"
					aria-label="Choose an agent"
					aria-expanded={open}
					onClick={() => setOpen(current => !current)}
				>
					▾
				</button>
			</div>
			<div
				className="mz-menu"
				data-open={open ? 'true' : 'false'}
				role="menu"
			>
				<div className="mz-menu-group">Run an agent</div>
				{AGENTS.map(agent => (
					<button
						key={agent.id}
						type="button"
						className="mz-menu-item"
						role="menuitem"
						onClick={() => handleAgent(agent.id)}
					>
						<span
							className="ag-dot"
							style={{ background: agent.dotColor }}
						/>
						<span className="ag-name">{agent.name}</span>
						<span className="ag-desc">{agent.description}</span>
						{agent.isDefault && (
							<span className="ag-def">default</span>
						)}
					</button>
				))}
				<div className="mz-menu-foot">
					agents are plugins — drop yours in{' '}
					<span className="mono">~/.mizraj/agents</span>
				</div>
			</div>
		</div>
	)
}
