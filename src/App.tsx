import { useEffect, useState } from 'react'

import './App.css'
import SettingsPanel from './components/SettingsPanel'
import { useSettings } from './lib/settings'

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
			<SettingsPanel
				open={panelOpen}
				onClose={() => setPanelOpen(false)}
				settings={settings}
			/>
		</main>
	)
}

export default App
