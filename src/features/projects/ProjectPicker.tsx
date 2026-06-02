import { open } from '@tauri-apps/plugin-dialog'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

type Props = {
	onSelect: (path: string) => void
}

export const ProjectPicker = ({ onSelect }: Props): React.JSX.Element => {
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
		<button type="button" className="project-picker" onClick={handleClick}>
			Choose repo
		</button>
	)
}
