import { useEffect, useState } from 'react'

import './App.css'
import MainContent from './components/MainContent'
import PlansMenu from './components/PlansMenu'
import ProjectPicker from './components/ProjectPicker'
import RunAgentButton from './components/RunAgentButton'
import SettingsPanel from './components/SettingsPanel'
import { useActiveProject } from './lib/activeProject'
import { useSettings } from './lib/settings'
import { navigate, tasksHref } from './router'

function App(): React.JSX.Element {
	const settings = useSettings()
	const activeProjectPath = useActiveProject(settings.lastProjectPath)
	const [panelOpen, setPanelOpen] = useState(false)

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
	}, [settings.theme])

	return (
		<main className="container">
			<header className="top-bar">
				<h1>Agent Cockpit</h1>
				<div className="top-bar__actions">
					<ProjectPicker onSelect={settings.setLastProjectPath} />
					{activeProjectPath !== null && (
						<RunAgentButton repoPath={activeProjectPath} />
					)}
					<button
						type="button"
						className="settings-trigger"
						aria-label="Open settings"
						onClick={() => setPanelOpen(true)}
					>
						⚙
					</button>
				</div>
			</header>
			<div className="layout">
				<aside className="sidebar" aria-label="Sidebar">
					<nav className="sidebar-nav" aria-label="Views">
						<a
							className="sidebar-nav__link"
							href={tasksHref()}
							onClick={event => {
								event.preventDefault()
								navigate(tasksHref())
							}}
						>
							Tasks
						</a>
					</nav>
					<PlansMenu repoPath={activeProjectPath} />
				</aside>
				<section className="main-content">
					<MainContent activeProjectPath={activeProjectPath} />
				</section>
			</div>
			<SettingsPanel
				open={panelOpen}
				onClose={() => setPanelOpen(false)}
				settings={settings}
			/>
		</main>
	)
}

export default App
