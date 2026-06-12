import { open } from '@tauri-apps/plugin-dialog'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

type Props = {
	activeProjectPath: string | null
	onSelect: (path: string) => void
}

const repoName = (path: string): string =>
	path.split('/').findLast(segment => segment !== '') ?? path

export const ProjectPicker = ({
	activeProjectPath,
	onSelect,
}: Props): React.JSX.Element => {
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
			className="project-picker"
			title={activeProjectPath ?? undefined}
			onClick={handleClick}
		>
			{activeProjectPath === null ? (
				'Choose repo'
			) : (
				<>
					<span className="project-picker__hint">repo</span>{' '}
					<b>{repoName(activeProjectPath)}</b> ▾
				</>
			)}
		</button>
	)
}
