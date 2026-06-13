/**
 * Browser-side Tauri mock for UI e2e: the app runs in plain Chromium, so
 * `window.__TAURI_INTERNALS__` is stubbed with deterministic multi-repo
 * fixtures. Injected via `page.addInitScript(installTauriMock, fixtures)` —
 * Playwright serializes the function and its single argument into the page.
 */

export const REPO_ALPHA = '/Users/demo/dev/alpha'
export const REPO_BETA = '/Users/demo/dev/beta'

const ALPHA_PATCH = [
	'diff --git a/main.ts b/main.ts',
	'index 1111111..2222222 100644',
	'--- a/main.ts',
	'+++ b/main.ts',
	'@@ -1,2 +1,3 @@',
	' keep',
	'-old',
	'+new',
	'+more',
	'',
].join('\n')

const wireTask = (
	id: string,
	title: string,
	status: string,
): Record<string, unknown> => ({
	id,
	identifier: null,
	origin: 'user',
	milestoneId: null,
	trackId: null,
	step: null,
	title,
	description: null,
	doneWhen: null,
	size: null,
	sliceOf: [],
	sinkId: null,
	position: 0,
	status,
	blockedReason: null,
	commitSha: null,
	createdAt: '2026-06-13T00:00:00Z',
})

export type RepoFixture = {
	branch: string
	patch: string
	userTasks: ReadonlyArray<Record<string, unknown>>
}

export type TauriMockFixtures = {
	projects: string[]
	repos: Record<string, RepoFixture>
}

/** The default two-repo world every multi-project e2e starts from. */
export const defaultFixtures = (): TauriMockFixtures => ({
	projects: [REPO_ALPHA, REPO_BETA],
	repos: {
		[REPO_ALPHA]: {
			branch: 'feat/alpha-work',
			patch: ALPHA_PATCH,
			userTasks: [wireTask('a1', 'Ship the alpha feature', 'backlog')],
		},
		[REPO_BETA]: {
			branch: 'fix/beta-bug',
			patch: '',
			userTasks: [wireTask('b1', 'Fix the beta bug', 'backlog')],
		},
	},
})

/**
 * Runs INSIDE the page (serialized by Playwright): no closure over module
 * scope, everything comes from `fixtures`.
 */
export const installTauriMock = (fixtures: TauriMockFixtures): void => {
	const state = { projects: [...fixtures.projects] }
	const repoOf = (args: Record<string, unknown>): RepoFixture | null => {
		const path = typeof args['repoPath'] === 'string' ? args['repoPath'] : ''
		return fixtures.repos[path] ?? null
	}

	const commands: Record<string, (args: Record<string, unknown>) => unknown> =
		{
			projects_list: () => state.projects,
			projects_add: args => {
				const path = String(args['repoPath'])
				if (!state.projects.includes(path)) state.projects.push(path)
				return path
			},
			projects_remove: args => {
				state.projects = state.projects.filter(
					known => known !== args['repoPath'],
				)
				return null
			},
			set_active_project: () => null,
			clear_active_project: () => null,
			repo_head: args => ({
				branch: repoOf(args)?.branch ?? null,
				detached: false,
			}),
			get_diff: args => ({ patch: repoOf(args)?.patch ?? '' }),
			tasks_overview: args => ({
				milestones: [],
				userTasks: repoOf(args)?.userTasks ?? [],
			}),
			session_subscribe: () => null,
			session_unsubscribe: () => null,
			session_default_shell: () => 'zsh',
			load_ghostty_config: () => null,
			list_plans: () => [],
			read_interview_state: () => null,
			log_from_frontend: () => null,
		}

	// Tauri plugin commands the app touches at boot.
	const pluginCommands: Record<string, unknown> = {
		'plugin:store|load': 1,
		'plugin:store|get': [null, false],
		'plugin:store|set': null,
		'plugin:store|save': null,
		'plugin:event|listen': null,
		'plugin:event|unlisten': null,
	}

	const internals = {
		invoke: (command: string, args?: Record<string, unknown>) => {
			const handler = commands[command]
			if (handler) return Promise.resolve(handler(args ?? {}))
			if (command in pluginCommands) {
				return Promise.resolve(pluginCommands[command])
			}
			return Promise.reject(new Error(`unmocked command: ${command}`))
		},
		transformCallback: (callback: (payload: unknown) => void): number => {
			const id = Math.floor(Math.random() * 1_000_000)
			Object.defineProperty(window, `_${id}`, {
				value: callback,
				writable: true,
				configurable: true,
			})
			return id
		},
		metadata: {
			currentWindow: { label: 'main' },
			currentWebview: { label: 'main' },
		},
		plugins: {},
	}

	Object.defineProperty(window, '__TAURI_INTERNALS__', {
		value: internals,
		writable: true,
		configurable: true,
	})
}
