import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef } from 'react'

import { describeError } from '../errors'
import type { Theme, UseSettings } from '../lib/settings'
import { logger } from '../logger'

type Props = {
	open: boolean
	onClose: () => void
	settings: UseSettings
}

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'system', label: 'System' },
]

const SettingsPanel = ({
	open: isOpen,
	onClose,
	settings,
}: Props): React.JSX.Element => {
	const dialogRef = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog) {
			return
		}
		if (isOpen && !dialog.open) {
			dialog.showModal()
			return
		}
		if (!isOpen && dialog.open) {
			dialog.close()
		}
	}, [isOpen])

	const handleTheme = (theme: Theme): void => {
		void settings.setTheme(theme).catch(error => {
			const { message, stack } = describeError(error)
			logger.error(`Settings: failed to set theme: ${message}`, {
				scope: 'settings',
				details: { stack, theme },
			})
		})
	}

	const handlePickProject = async (): Promise<void> => {
		try {
			const result = await openDialog({
				directory: true,
				multiple: false,
				title: 'Choose default project folder',
			})
			if (typeof result === 'string') {
				await settings.setLastProjectPath(result)
			}
		} catch (error) {
			const { message, stack } = describeError(error)
			logger.error(`Settings: failed to pick project: ${message}`, {
				scope: 'settings',
				details: { stack },
			})
		}
	}

	const handleClearProject = (): void => {
		void settings.setLastProjectPath(null).catch(error => {
			const { message, stack } = describeError(error)
			logger.error(`Settings: failed to clear project: ${message}`, {
				scope: 'settings',
				details: { stack },
			})
		})
	}

	return (
		<dialog
			ref={dialogRef}
			className="settings-panel"
			onClose={onClose}
			aria-label="Settings"
		>
			<header className="settings-panel__header">
				<h2>Settings</h2>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close settings"
					className="settings-panel__close"
				>
					×
				</button>
			</header>

			<section className="settings-panel__section">
				<h3>Theme</h3>
				<div
					role="radiogroup"
					aria-label="Theme"
					className="settings-panel__theme"
				>
					{THEME_OPTIONS.map(option => (
						<label
							key={option.value}
							className="settings-panel__theme-option"
						>
							<input
								type="radio"
								name="theme"
								value={option.value}
								checked={settings.theme === option.value}
								onChange={() => handleTheme(option.value)}
								disabled={!settings.ready}
							/>
							{option.label}
						</label>
					))}
				</div>
			</section>

			<section className="settings-panel__section">
				<h3>Default project</h3>
				<p className="settings-panel__project-path">
					{settings.lastProjectPath ?? 'No default project selected'}
				</p>
				<div className="settings-panel__project-actions">
					<button
						type="button"
						onClick={() => {
							void handlePickProject()
						}}
						disabled={!settings.ready}
					>
						Choose folder…
					</button>
					{settings.lastProjectPath !== null && (
						<button
							type="button"
							onClick={handleClearProject}
							disabled={!settings.ready}
						>
							Clear
						</button>
					)}
				</div>
			</section>
		</dialog>
	)
}

export default SettingsPanel
