import { open } from '@tauri-apps/plugin-dialog'

import { matchMissionControlRoute, usePathname } from '@/app/router'
import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

type Props = {
	activeProjectPath: string | null
	onSelect: (path: string) => void
}

const repoName = (path: string): string =>
	path.split('/').findLast(segment => segment !== '') ?? path

type ScopeLabelProps = {
	activeProjectPath: string | null
	onMissionRoute: boolean
}

// TODO(multi-project): mission control is single-repo today; the
// 'all projects' scope label is aspirational until multi-project lands.
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
			<span>repo</span> <b>{repoName(activeProjectPath)}</b>{' '}
			<span className="carat">▾</span>
		</>
	)
}

export const ProjectPicker = ({
	activeProjectPath,
	onSelect,
}: Props): React.JSX.Element => {
	const pathname = usePathname()

	const handleClick = (): void => {
		open({ directory: true })
			.then(selected => {
				if (selected === null) return
				onSelect(selected)
			})
			.catch((error: unknown) => {
				const { message, stack } = describeError(error)
				logger.error(`ProjectPicker: open dialog failed: ${message}`, {
					scope: 'project-picker',
					details: { stack },
				})
			})
	}

	return (
		<button
			type="button"
			className="mz-proj"
			title={activeProjectPath ?? undefined}
			onClick={handleClick}
		>
			<ScopeLabel
				activeProjectPath={activeProjectPath}
				onMissionRoute={matchMissionControlRoute(pathname)}
			/>
		</button>
	)
}
