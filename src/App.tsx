import { useEffect, useState } from 'react'

import './App.css'
import PlansMenu from './components/PlansMenu'
import SettingsPanel from './components/SettingsPanel'
import { useSettings } from './lib/settings'
import PlanView from './views/PlanView'

function App(): React.JSX.Element {
	const settings = useSettings()
	const [panelOpen, setPanelOpen] = useState(false)

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
	}, [settings.theme])

	return (
		<main className="container">
			<header className="top-bar">
				<h1>Agent Cockpit</h1>
				<button
					type="button"
					className="settings-trigger"
					aria-label="Open settings"
					onClick={() => setPanelOpen(true)}
				>
					⚙
				</button>
			</header>
			<div className="layout">
				<aside className="sidebar" aria-label="Sidebar">
					<PlansMenu repoPath={settings.lastProjectPath} />
				</aside>
				<section className="main-content">
					<PlanView />
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
