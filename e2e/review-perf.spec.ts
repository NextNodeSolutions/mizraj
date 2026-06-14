/**
 * Runtime performance guards for the review page, in real Chromium against the
 * production build (so the @pierre/diffs ES-module worker pool actually runs).
 * Two complaints are covered, each with its own best-practice metric:
 *
 *   A. "switching files replays the whole entrance animation" — asserted via an
 *      animationstart probe: ZERO entrance animations may fire under .review on
 *      a file switch (run with motion ENABLED, after first proving riseIn fires
 *      once on initial load so a zero count is real, not globally-disabled).
 *
 *   B. "the click registers late, sometimes not at all" — asserted via Event
 *      Timing (INP-style click-to-next-paint), Long Tasks and Long Animation
 *      Frames (run with reduced motion to isolate interaction cost from
 *      decorative motion). Fine numbers are logged as evidence; the hard gates
 *      are deterministic: no dropped click, no long blocking task, snappy
 *      wall-clock, no console errors.
 *
 * Lives in its own non-parallel Playwright project (see playwright.config.ts)
 * so nothing else steals the main thread mid-measurement.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const REPO = '/Users/demo/dev/alpha'

// A switch that renders under this wall-clock is imperceptible; the old
// synchronous-remount path blew past it. Generous so CPU variance never flakes
// — the logged Event-Timing numbers are the real evidence.
const SNAPPY_MS = 600
// A single main-thread block longer than this is what swallows a click; a full
// remount + from-scratch re-tokenize trips it, an in-place update never does.
const LONGTASK_MAX_MS = 250
// Past riseIn's longest duration (0.35s), so a replay would have fired
// animationstart before we sample.
const ANIM_SETTLE_MS = 450

type FileSpec = { path: string; marker: string; body: string }

// Distinct languages so the worker resolves several Shiki grammars, with enough
// lines that tokenization is real work (not a two-line toy).
const repeat = (block: string, times: number): string =>
	Array.from({ length: times }, (_unused, i) =>
		block.replaceAll('%i%', String(i)),
	).join('\n')

const FILES: ReadonlyArray<FileSpec> = [
	{
		path: 'src/engine/scheduler.ts',
		marker: 'SCHEDULER_MARKER_0',
		body: `export const SCHEDULER_MARKER_0 = true\n${repeat(
			'export const compute%i% = (n: number): number => n * %i% + Math.floor(n / 2)',
			120,
		)}`,
	},
	{
		path: 'src/ui/Panel.tsx',
		marker: 'PANEL_MARKER_1',
		body: `export const PANEL_MARKER_1 = 'panel'\n${repeat(
			'export const Row%i% = (): JSX.Element => <div className="row-%i%">{%i%}</div>',
			120,
		)}`,
	},
	{
		path: 'src/styles/theme.css',
		marker: 'theme-marker-2',
		body: `/* theme-marker-2 */\n${repeat(
			'.token-%i% { color: hsl(%i%, 50%, 50%); padding: %i%px; border: 1px solid #abc; }',
			120,
		)}`,
	},
	{
		path: 'src-tauri/src/diff.rs',
		marker: 'rust_marker_3',
		body: `pub const RUST_MARKER_3: &str = "rust_marker_3";\n${repeat(
			'pub fn handle_%i%(input: &str) -> Result<usize, String> { Ok(input.len() + %i%) }',
			120,
		)}`,
	},
	{
		path: 'config/settings.json',
		marker: 'json-marker-4',
		body: `{\n  "marker": "json-marker-4",\n${repeat(
			'  "key_%i%": { "id": %i%, "enabled": true, "label": "item-%i%" },',
			110,
		)}\n  "end": true\n}`,
	},
]

const fileToPatch = ({ path, body }: FileSpec): string => {
	const lines = body.split('\n')
	return [
		`diff --git a/${path} b/${path}`,
		'new file mode 100644',
		'index 0000000..1111111',
		'--- /dev/null',
		`+++ b/${path}`,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map(line => `+${line}`),
		'',
	].join('\n')
}

const BIG_PATCH = FILES.map(fileToPatch).join('\n')

// A larger, all-cold file set for the rapid-fire burst: 24 distinct files
// cycling five languages so every first visit is a real (uncached) tokenize —
// the warmed 5-file set above would hit the LRU cache and hide the pile-up.
const BURST_LANGS: ReadonlyArray<{
	ext: string
	head: (marker: string, i: number) => string
	line: string
}> = [
	{
		ext: 'ts',
		head: (m, i) => `export const ${m} = ${i}`,
		line: 'export const v%i% = (n: number): number => n + %i%',
	},
	{
		ext: 'tsx',
		head: (m, i) => `export const ${m} = ${i}`,
		line: 'export const C%i% = (): JSX.Element => <b className="r-%i%">{%i%}</b>',
	},
	{
		ext: 'css',
		head: m => `.${m} { color: red }`,
		line: '.cls-%i% { color: hsl(%i%, 40%, 50%); padding: %i%px }',
	},
	{
		ext: 'rs',
		head: (m, i) => `pub const ${m}: usize = ${i};`,
		line: 'pub fn fn_%i%(x: usize) -> usize { x + %i% }',
	},
	{
		ext: 'json',
		head: (m, i) => `  "${m}": ${i},`,
		line: '  "key_%i%": { "id": %i%, "on": true },',
	},
]

const burstFile = (i: number): FileSpec => {
	const variant = BURST_LANGS[i % BURST_LANGS.length]
	const marker = `BURST_MARKER_${i}`
	const repeated = repeat(variant.line, 80)
	const body =
		variant.ext === 'json'
			? `{\n${variant.head(marker, i)}\n${repeated}\n  "tail": true\n}`
			: `${variant.head(marker, i)}\n${repeated}`
	return { path: `src/burst/mod_${i}.${variant.ext}`, marker, body }
}

const MANY: ReadonlyArray<FileSpec> = Array.from({ length: 24 }, (_unused, i) =>
	burstFile(i),
)
const MANY_PATCH = MANY.map(fileToPatch).join('\n')

// Installed via addInitScript: stubs window.__TAURI_INTERNALS__ so a fresh
// /review load resolves alpha as the active project (store get) and serves the
// heavy patch from get_diff — no SPA-navigation dance needed.
const installMock = (args: { repo: string; patch: string }): void => {
	const commands: Record<string, (a: Record<string, unknown>) => unknown> = {
		projects_list: () => [args.repo],
		set_active_project: () => null,
		clear_active_project: () => null,
		repo_head: () => ({ branch: 'feat/perf', detached: false }),
		get_diff: () => ({ patch: args.patch }),
		tasks_overview: () => ({ milestones: [], userTasks: [] }),
		session_subscribe: () => null,
		session_unsubscribe: () => null,
		session_default_shell: () => 'zsh',
		load_ghostty_config: () => null,
		list_plans: () => [],
		read_interview_state: () => null,
		log_from_frontend: () => null,
	}
	const internals = {
		invoke: (command: string, a?: Record<string, unknown>) => {
			if (command === 'plugin:store|load') return Promise.resolve(1)
			if (command === 'plugin:store|get') {
				const key = a?.['key']
				return Promise.resolve(
					key === 'lastProjectPath'
						? [args.repo, true]
						: [null, false],
				)
			}
			if (
				command === 'plugin:store|set' ||
				command === 'plugin:store|save' ||
				command === 'plugin:event|listen' ||
				command === 'plugin:event|unlisten'
			) {
				return Promise.resolve(null)
			}
			const handler = commands[command]
			if (handler) return Promise.resolve(handler(a ?? {}))
			return Promise.reject(new Error(`unmocked command: ${command}`))
		},
		transformCallback: (cb: (payload: unknown) => void): number => {
			const id = 1
			Object.defineProperty(window, `_${id}`, {
				value: cb,
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

type AnimEntry = { name: string; target: string; time: number }
type EventEntry = {
	name: string
	start: number
	duration: number
	procStart: number
	procEnd: number
	interactionId: number
}
type LongTaskEntry = { start: number; duration: number }
type LoafEntry = { start: number; duration: number; blockingDuration: number }
type PerfState = {
	anim: Array<AnimEntry>
	events: Array<EventEntry>
	longtasks: Array<LongTaskEntry>
	loaf: Array<LoafEntry>
}

// The optional extra fields let a base PerformanceEntry widen into these
// without a type assertion (the repo forbids `as`): they exist at runtime on
// Event Timing / LoAF entries but aren't on the base lib.dom type.
interface TimingEntry extends PerformanceEntry {
	processingStart?: number
	processingEnd?: number
	interactionId?: number
}
interface LoafPerfEntry extends PerformanceEntry {
	blockingDuration?: number
}

declare global {
	interface Window {
		__perf: PerfState
	}
}

// Installed via addInitScript BEFORE navigation so the very first interaction
// and the first-load animations are captured. PerformanceObserver(buffered)
// surfaces entries that fired before the observer attached.
const installPerfProbes = (): void => {
	const state: PerfState = { anim: [], events: [], longtasks: [], loaf: [] }
	window.__perf = state

	// Entrance-animation replay probe: any CSS animation that starts on an
	// element inside .review (capture phase so it can't be missed).
	document.addEventListener(
		'animationstart',
		event => {
			const el = event.target
			if (!(el instanceof Element) || el.closest('.review') === null)
				return
			state.anim.push({
				name: event.animationName,
				target: el.className,
				time: performance.now(),
			})
		},
		true,
	)

	// INP-style click-to-next-paint: 'event' entries already end at the paint
	// following the handlers; interactionId groups pointer/click of one tap.
	try {
		new PerformanceObserver(list => {
			for (const entry of list.getEntries()) {
				const ev: TimingEntry = entry
				if (ev.interactionId === undefined || ev.interactionId === 0) {
					continue
				}
				state.events.push({
					name: entry.name,
					start: entry.startTime,
					duration: entry.duration,
					procStart: ev.processingStart ?? entry.startTime,
					procEnd: ev.processingEnd ?? entry.startTime,
					interactionId: ev.interactionId,
				})
			}
		}).observe({ type: 'event', durationThreshold: 16, buffered: true })
	} catch {
		// Event Timing unsupported — numbers just won't be logged.
	}

	try {
		new PerformanceObserver(list => {
			for (const entry of list.getEntries()) {
				state.longtasks.push({
					start: entry.startTime,
					duration: entry.duration,
				})
			}
		}).observe({ type: 'longtask', buffered: true })
	} catch {
		// longtask unsupported.
	}

	try {
		const supported =
			PerformanceObserver.supportedEntryTypes?.includes(
				'long-animation-frame',
			) ?? false
		if (supported) {
			new PerformanceObserver(list => {
				for (const entry of list.getEntries()) {
					const loaf: LoafPerfEntry = entry
					state.loaf.push({
						start: entry.startTime,
						duration: entry.duration,
						blockingDuration: loaf.blockingDuration ?? 0,
					})
				}
			}).observe({ type: 'long-animation-frame', buffered: true })
		}
	} catch {
		// LoAF unsupported on this Chromium — skip, never fail on a missing type.
	}
}

const fileLabel = (file: FileSpec): string =>
	file.path.split('/').pop() ?? file.path

const byName = (page: Page, name: string): Locator =>
	page.locator('.review-tree__file', { hasText: name })

// Resolves once the diff pane shows `path` with that file's marker highlighted
// in the renderer's shadow DOM — i.e. tokenization for the new file finished.
const waitForFileRendered = (
	page: Page,
	path: string,
	marker: string,
): Promise<unknown> =>
	page.waitForFunction(
		({ p, m }) => {
			const head = document.querySelector('.review__diff-path')
			if (head?.textContent !== p) return false
			const container = document.querySelector('diffs-container')
			const text = container?.shadowRoot?.textContent ?? ''
			return text.includes(m)
		},
		{ p: path, m: marker },
		{ timeout: 10_000 },
	)

const settleFrames = (page: Page): Promise<unknown> =>
	page.evaluate(
		() =>
			new Promise(resolve =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	)

const openReviewWith = async (
	page: Page,
	patch: string,
	expectedCount: number,
): Promise<void> => {
	await page.addInitScript(installPerfProbes)
	await page.addInitScript(installMock, { repo: REPO, patch })
	await page.goto('/review')
	await expect(page.locator('.review-tree__file')).toHaveCount(expectedCount)
}

const openReview = (page: Page): Promise<void> =>
	openReviewWith(page, BIG_PATCH, FILES.length)

// One file switch with its interaction metrics, windowed by a pre-click
// snapshot so concurrent unrelated entries never fold into the number.
type SwitchSample = {
	file: string
	wallMs: number
	inpMs: number | null
	inputDelayMs: number | null
	processingMs: number | null
	longtaskMaxMs: number
	loafBlockingMaxMs: number
}

const measureSwitch = async (
	page: Page,
	file: FileSpec,
): Promise<SwitchSample> => {
	const baseline = await page.evaluate(() => ({
		events: window.__perf.events.length,
		longtasks: window.__perf.longtasks.length,
		loaf: window.__perf.loaf.length,
		t: performance.now(),
	}))
	const start = Date.now()
	await byName(page, fileLabel(file)).click()
	await waitForFileRendered(page, file.path, file.marker)
	const wallMs = Date.now() - start
	// A swallowed click would leave the previous path showing.
	await expect(page.locator('.review__diff-path')).toHaveText(file.path)
	// Two frames so Event Timing finalizes the interaction's presentation delay.
	await settleFrames(page)

	const sample = await page.evaluate(b => {
		const events = window.__perf.events.slice(b.events)
		const taps = events.filter(
			e => e.name === 'click' || e.name === 'pointerup',
		)
		const id = taps.length > 0 ? taps[taps.length - 1].interactionId : null
		const group =
			id === null ? [] : events.filter(e => e.interactionId === id)
		const inpMs =
			group.length > 0 ? Math.max(...group.map(e => e.duration)) : null
		const inputDelayMs =
			group.length > 0
				? Math.min(...group.map(e => e.procStart - e.start))
				: null
		const processingMs =
			group.length > 0
				? Math.max(...group.map(e => e.procEnd - e.procStart))
				: null
		const longtasks = window.__perf.longtasks
			.slice(b.longtasks)
			.filter(e => e.start + e.duration >= b.t)
		const longtaskMaxMs =
			longtasks.length > 0
				? Math.max(...longtasks.map(e => e.duration))
				: 0
		const loaf = window.__perf.loaf
			.slice(b.loaf)
			.filter(e => e.start + e.duration >= b.t)
		const loafBlockingMaxMs =
			loaf.length > 0 ? Math.max(...loaf.map(e => e.blockingDuration)) : 0
		return {
			inpMs,
			inputDelayMs,
			processingMs,
			longtaskMaxMs,
			loafBlockingMaxMs,
		}
	}, baseline)

	return { file: fileLabel(file), wallMs, ...sample }
}

test('switching files never replays the entrance animation', async ({
	page,
}) => {
	// Motion ENABLED: under prefers-reduced-motion the entrance rules are
	// animation:none, which would mask a real regression as a false pass.
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	const consoleErrors: string[] = []
	page.on('console', msg => {
		if (msg.type() === 'error') consoleErrors.push(msg.text())
	})

	await openReview(page)
	const first = FILES[0]
	await waitForFileRendered(page, first.path, first.marker)

	// Sanity: the entrance animation DID fire once on first page entry — proves
	// animations are globally enabled and the probe works, so a zero count on
	// switch is a real signal.
	await new Promise(resolve => setTimeout(resolve, ANIM_SETTLE_MS))
	const onLoad = await page.evaluate(() =>
		window.__perf.anim.map(a => a.name),
	)
	expect(
		onLoad.filter(name => name === 'riseIn').length,
		'riseIn plays on first page entry (motion is enabled)',
	).toBeGreaterThan(0)

	// Every file switch must add ZERO entrance animations under .review.
	const replays: Array<{ file: string; anims: Array<string> }> = []
	for (const file of [...FILES.slice(1), first]) {
		const before = await page.evaluate(() => window.__perf.anim.length)
		await byName(page, fileLabel(file)).click()
		await waitForFileRendered(page, file.path, file.marker)
		await expect(page.locator('.review__diff-path')).toHaveText(file.path)
		await new Promise(resolve => setTimeout(resolve, ANIM_SETTLE_MS))
		const fresh = await page.evaluate(
			b => window.__perf.anim.slice(b).map(a => `${a.name}@${a.target}`),
			before,
		)
		replays.push({ file: fileLabel(file), anims: fresh })
	}

	// eslint-disable-next-line no-console
	console.log(`[review-perf:anim] ${JSON.stringify(replays)}`)

	const totalReplays = replays.reduce((sum, r) => sum + r.anims.length, 0)
	expect(totalReplays, 'no entrance animation replays on a file switch').toBe(
		0,
	)
	expect(consoleErrors, 'no runtime errors during switching').toEqual([])
})

test('switching files stays snappy: instant click, no long blocking task', async ({
	page,
}) => {
	// Reduced motion isolates real interaction cost from decorative animation
	// frames, stabilizing the click-to-paint numbers.
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const consoleErrors: string[] = []
	page.on('console', msg => {
		if (msg.type() === 'error') consoleErrors.push(msg.text())
	})

	await openReview(page)
	const first = FILES[0]
	await waitForFileRendered(page, first.path, first.marker)

	// Off-thread highlighting proof: the worker chunk must have loaded.
	const workerLoaded = await page.evaluate(() =>
		performance
			.getEntriesByType('resource')
			.some(entry => /worker[-.]/.test(entry.name)),
	)
	expect(workerLoaded, 'a @pierre/diffs worker chunk should load').toBe(true)

	const others = FILES.slice(1)
	// Warmup absorbs each language's cold grammar load; assert on steady only.
	for (const file of [...others, first]) {
		await byName(page, fileLabel(file)).click()
		await waitForFileRendered(page, file.path, file.marker)
	}
	await settleFrames(page)

	const steady: Array<SwitchSample> = []
	for (const file of [...others, first]) {
		steady.push(await measureSwitch(page, file))
	}

	const maxWall = Math.max(...steady.map(s => s.wallMs))
	const maxLongtask = Math.max(...steady.map(s => s.longtaskMaxMs))
	const inpValues = steady
		.map(s => s.inpMs)
		.filter((value): value is number => value !== null)
	const maxInp = inpValues.length > 0 ? Math.max(...inpValues) : null
	// eslint-disable-next-line no-console
	console.log(
		`[review-perf:latency] steady=${JSON.stringify(steady)} maxWallMs=${maxWall} maxLongtaskMs=${maxLongtask} maxInpMs=${maxInp ?? 'n/a'} workerLoaded=${workerLoaded}`,
	)

	// Deterministic gates; the fine INP/LoAF numbers above are logged evidence.
	expect(consoleErrors, 'no runtime errors during switching').toEqual([])
	expect(maxWall, 'steady click→render wall-clock stays snappy').toBeLessThan(
		SNAPPY_MS,
	)
	expect(
		maxLongtask,
		'no main-thread block long enough to swallow a click',
	).toBeLessThan(LONGTASK_MAX_MS)
})

test('rapid consecutive clicks never pile up or drop the final selection', async ({
	page,
}) => {
	// Reproduces the real complaint: clicking through files FAST (no wait between
	// clicks) on a 24-file all-cold diff, under 6× CPU throttle to stand in for
	// the slower Tauri WKWebView. A pile-up shows as click latency that grows
	// across the burst and a view stranded on a stale file.
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const consoleErrors: string[] = []
	page.on('console', msg => {
		if (msg.type() === 'error') consoleErrors.push(msg.text())
	})

	await openReviewWith(page, MANY_PATCH, MANY.length)
	const first = MANY[0]
	await waitForFileRendered(page, first.path, first.marker)

	const client = await page.context().newCDPSession(page)
	await client.send('Emulation.setCPUThrottlingRate', { rate: 6 })

	const before = await page.evaluate(() => ({
		events: window.__perf.events.length,
		longBefore: window.__perf.longtasks.reduce(
			(sum, l) => sum + l.duration,
			0,
		),
		t: performance.now(),
	}))

	// THE BURST: click every remaining file in order, back-to-back, WITHOUT
	// awaiting any render in between.
	for (const file of MANY.slice(1)) {
		await byName(page, fileLabel(file)).click()
	}
	const last = MANY[MANY.length - 1]

	// The view must catch up to the LAST clicked file — rapid fire may not
	// strand it on a stale file nor drop the final click.
	await waitForFileRendered(page, last.path, last.marker)
	await expect(page.locator('.review__diff-path')).toHaveText(last.path)
	await settleFrames(page)
	await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })

	const burst = await page.evaluate(b => {
		const clicks = window.__perf.events
			.slice(b.events)
			.filter(e => e.name === 'click')
			.map(e => e.duration)
		const avg = (a: Array<number>): number =>
			a.length > 0 ? a.reduce((sum, x) => sum + x, 0) / a.length : 0
		const half = Math.floor(clicks.length / 2)
		const longSumMs =
			window.__perf.longtasks.reduce((sum, l) => sum + l.duration, 0) -
			b.longBefore
		return {
			registered: clicks.length,
			maxClickMs: clicks.length > 0 ? Math.max(...clicks) : 0,
			firstHalfAvgMs: avg(clicks.slice(0, half)),
			lastHalfAvgMs: avg(clicks.slice(half)),
			longSumMs,
			wallMs: performance.now() - b.t,
			clicks,
		}
	}, before)

	// eslint-disable-next-line no-console
	console.log(`[review-perf:burst] ${JSON.stringify(burst)}`)

	expect(consoleErrors, 'no runtime errors during the burst').toEqual([])
	// The "de plus en plus long" guard: the back half of the burst must not be
	// dramatically slower than the front (with a floor so warm-fast runs that
	// idle near zero don't flake on noise).
	expect(
		burst.lastHalfAvgMs,
		'click latency must not degrade across a rapid burst',
	).toBeLessThan(Math.max(120, burst.firstHalfAvgMs * 3))
	// No single click may balloon into the dropped-click zone.
	expect(
		burst.maxClickMs,
		'no click interaction balloons under rapid fire',
	).toBeLessThan(1500)
})
