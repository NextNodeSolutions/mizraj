import { useEffect, useState } from 'react'

import './App.css'
import PlansMenu from './components/PlansMenu'
import ProjectPicker from './components/ProjectPicker'
import RunAgentButton from './components/RunAgentButton'
import SessionSidebar from './components/SessionSidebar'
import SettingsPanel from './components/SettingsPanel'
import { useActiveProject } from './lib/activeProject'
import { useSettings } from './lib/settings'
import { useSessions } from './lib/useSessions'
import { matchAgentRunRoute, usePathname } from './router'
import AgentRun from './views/AgentRun'
import PlanView from './views/PlanView'

const activeSessionsLabel = (count: number): string =>
	`${count} active ${count === 1 ? 'session' : 'sessions'}`

function App(): React.JSX.Element {
	const settings = useSettings()
	const activeProjectPath = useActiveProject(settings.lastProjectPath)
	const [panelOpen, setPanelOpen] = useState(false)
	const pathname = usePathname()
	const agentRunRoute = matchAgentRunRoute(pathname)
	const sessions = useSessions()
	const activeSessionCount = sessions.filter(
		session => session.status === 'running',
	).length

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
	}, [settings.theme])

	return (
		<main className="container">
			<header className="top-bar">
				<div className="top-bar__brand">
					<h1>Agent Cockpit</h1>
					<span className="top-bar__session-count" role="status">
						{activeSessionsLabel(activeSessionCount)}
					</span>
				</div>
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
					<SessionSidebar
						activeSessionId={agentRunRoute?.sessionId ?? null}
					/>
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
