import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react'
import type {
	WorkerInitializationRenderOptions,
	WorkerPoolOptions,
} from '@pierre/diffs/react'
import { useEffect } from 'react'
// Vite bundles the @pierre/diffs worker entry as a dedicated worker chunk; the
// `?worker` default export is a zero-arg Worker constructor.
// oxlint-disable-next-line import/default -- Vite virtual module; the default export exists at build time, not in the resolved .js
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'

import { warmDiffPool } from '@/shared/diffPoolWarmup'
import { NEXTNODE_DIFF_THEME } from '@/shared/theme/shiki-nextnode'

type Props = {
	children: React.ReactNode
}

// One file shows at a time; two workers let us highlight the next while the
// current paints, without spinning up the default eight.
const DIFF_POOL_SIZE = 2

// Idle-callback budget before we warm anyway, and the fallback delay when the
// WKWebView lacks requestIdleCallback. Warming runs in the workers, off the
// main thread, so these only stagger the cheap main-thread submission.
const WARM_IDLE_TIMEOUT_MS = 2000
const WARM_FALLBACK_DELAY_MS = 200

// One Web Worker pool for every @pierre/diffs renderer in the app. Without it
// the library tokenizes synchronously on the main thread on every render —
// which froze the review pane and dropped clicks on each file switch. The pool
// moves Shiki off-thread and keeps a shared LRU cache, so re-opening a file is
// instant. The singleton lives for the whole session (mounted above the router
// and outside StrictMode), so the cache survives navigation.
const workerFactory = (): Worker => new DiffsWorker()

const POOL_OPTIONS: WorkerPoolOptions = {
	workerFactory,
	poolSize: DIFF_POOL_SIZE,
}

const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
	// Preload both Catppuccin themes so a theme flip never blocks on a load.
	theme: NEXTNODE_DIFF_THEME,
	// JS regex engine: no WASM to fetch, plenty fast for diff-sized inputs.
	preferredHighlighter: 'shiki-js',
	// Warm this repo's grammars at boot (the pool starts initializing when this
	// provider mounts, above the router), so the first file opened in review
	// renders without paying a per-language grammar load on the hot path.
	langs: [
		'typescript',
		'tsx',
		'javascript',
		'jsx',
		'json',
		'css',
		'rust',
		'markdown',
		'toml',
	],
}

// Defer to idle so warming never competes with first paint; fall back to a
// timer where requestIdleCallback is missing. Returns its own canceller.
const scheduleIdle = (task: () => void): (() => void) => {
	if (typeof requestIdleCallback === 'function') {
		const handle = requestIdleCallback(task, {
			timeout: WARM_IDLE_TIMEOUT_MS,
		})
		return () => cancelIdleCallback(handle)
	}
	const handle = setTimeout(task, WARM_FALLBACK_DELAY_MS)
	return () => clearTimeout(handle)
}

// Synchronizes with the worker pool (an external system): once it exists, warm
// every grammar on both workers during idle time, so the first cockpit visit
// opens files at full speed instead of paying the per-worker JIT curve.
const DiffPoolWarmup = (): null => {
	const pool = useWorkerPool()
	useEffect(() => {
		if (pool === undefined) return
		return scheduleIdle(() => warmDiffPool(pool, DIFF_POOL_SIZE))
	}, [pool])
	return null
}

export const DiffWorkerPool = ({ children }: Props): React.JSX.Element => (
	<WorkerPoolContextProvider
		poolOptions={POOL_OPTIONS}
		highlighterOptions={HIGHLIGHTER_OPTIONS}
	>
		{/* Outside StrictMode (children carry it), so the warm-up effect runs
		    once, not twice. */}
		<DiffPoolWarmup />
		{children}
	</WorkerPoolContextProvider>
)
