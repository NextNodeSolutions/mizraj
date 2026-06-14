import { openPalette } from '@/features/palette/palette'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { SplitNew } from '@/features/sessions/SplitNew'
import { IconGear } from '@/shared/ui/icons'

import { missionControlHref, navigate } from './router'
import { StatusCluster } from './StatusCluster'

type Props = {
	activeProjectPath: string | null
	onSelectProject: (path: string) => void
	onOpenSettings: () => void
}

// Navigation lives in the left rail; the topbar carries identity, scope,
// the live status cluster and the launch actions.
export const TopBar = ({
	activeProjectPath,
	onSelectProject,
	onOpenSettings,
}: Props): React.JSX.Element => (
	<header className="mz-topbar">
		<button
			type="button"
			className="mz-brand"
			onClick={() => navigate(missionControlHref())}
		>
			<span className="mz-glyph" aria-hidden="true">
				M
			</span>
			<span>Mizraj</span>
		</button>
		<ProjectPicker
			activeProjectPath={activeProjectPath}
			onSelect={onSelectProject}
		/>
		<span className="mz-topbar-sep" />
		<StatusCluster />
		<span className="mz-spacer" />
		<button type="button" className="mz-cmdk" onClick={openPalette}>
			<span>Jump to…</span>
			<span className="mz-kbd">⌘K</span>
		</button>
		{activeProjectPath !== null && (
			<SplitNew repoPath={activeProjectPath} />
		)}
		<button
			type="button"
			className="mz-iconbtn"
			aria-label="Settings"
			onClick={onOpenSettings}
		>
			<IconGear />
		</button>
	</header>
)
