import { useEffect, useState } from 'react'

import './App.css'
import PlansMenu from './components/PlansMenu'
import RunAgentButton from './components/RunAgentButton'
import SettingsPanel from './components/SettingsPanel'
import { useActiveProject } from './lib/activeProject'
import { useSettings } from './lib/settings'
import { matchAgentRunRoute, usePathname } from './router'
import AgentRun from './views/AgentRun'
import PlanView from './views/PlanView'

function App(): React.JSX.Element {
	const settings = useSettings()
	const activeProjectPath = useActiveProject(settings.lastProjectPath)
	const [panelOpen, setPanelOpen] = useState(false)
	const pathname = usePathname()
	const agentRunRoute = matchAgentRunRoute(pathname)

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
	}, [settings.theme])

	return (
		<main className="container">
			<header className="top-bar">
				<h1>Agent Cockpit</h1>
				<div className="top-bar__actions">
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
					<PlansMenu repoPath={activeProjectPath} />
				</aside>
				<section className="main-content">
					{agentRunRoute ? (
						<AgentRun
							key={agentRunRoute.sessionId}
							sessionId={agentRunRoute.sessionId}
						/>
					) : (
						<PlanView />
					)}
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
