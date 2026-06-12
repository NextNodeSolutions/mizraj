import { useEffect, useState } from 'react'

import './App.css'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { useActiveProject } from '@/features/projects/activeProject'
import { useGhosttyTheme } from '@/features/sessions/useGhosttyTheme'
import { useSettings } from '@/features/settings/settings'
import { SettingsPanel } from '@/features/settings/SettingsPanel'

import { MainContent } from './MainContent'
import { Toasts } from './Toasts'
import { TopBar } from './TopBar'

export function App(): React.JSX.Element {
	const settings = useSettings()
	const activeProjectPath = useActiveProject(settings.lastProjectPath)
	const [panelOpen, setPanelOpen] = useState(false)

	// Drives the app-wide chrome from the resolved Ghostty theme when one is
	// present; layers inline custom properties on <html> that win over the
	// data-theme stylesheet below. With no Ghostty theme it is a no-op and the
	// Catppuccin tokens stand.
	useGhosttyTheme()

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
	}, [settings.theme])

	return (
		<main className="container">
			<TopBar
				activeProjectPath={activeProjectPath}
				onSelectProject={settings.setLastProjectPath}
				onOpenSettings={() => setPanelOpen(true)}
			/>
			<section className="main-content">
				<MainContent activeProjectPath={activeProjectPath} />
			</section>
			<SettingsPanel
				open={panelOpen}
				onClose={() => setPanelOpen(false)}
				settings={settings}
			/>
			<CommandPalette activeProjectPath={activeProjectPath} />
			<Toasts />
		</main>
	)
}
