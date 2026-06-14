import { defineConfig, devices } from '@playwright/test'

const PREVIEW_PORT = 4180
// Bind the preview to the exact interface Playwright polls. Left to its default
// `localhost`, vite preview resolves to ::1 (IPv6) first on the Linux CI runner
// while the webServer health check hits 127.0.0.1 (IPv4) — the URL never answers
// and the run dies on the 180s webServer timeout. Pinning the host on both sides
// keeps the build (cheap, fast) and the unreachable-preview failure apart.
const PREVIEW_HOST = '127.0.0.1'
const BASE_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
	},
	// One framework-managed server for every spec: it builds first so the
	// preview serves a fresh dist/ (the bare `vite preview` the specs used to
	// spawn themselves silently served a stale or missing build — fatal in CI).
	webServer: {
		command: `pnpm build && pnpm vite preview --host ${PREVIEW_HOST} --port ${PREVIEW_PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: 'ignore',
		stderr: 'pipe',
	},
	projects: [
		{
			name: 'chromium',
			// The perf spec runs in its own non-parallel project so other specs'
			// pages don't contend for CPU and pollute its interaction timings.
			testIgnore: '**/review-perf.spec.ts',
			use: devices['Desktop Chrome'],
		},
		{
			name: 'perf',
			testMatch: '**/review-perf.spec.ts',
			// Serial + isolated: interaction-latency numbers are only meaningful
			// when nothing else steals the main thread mid-measurement.
			fullyParallel: false,
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					// Keep the page foreground-scheduled so rAF/timers aren't
					// throttled while we measure click-to-paint.
					args: [
						'--disable-background-timer-throttling',
						'--disable-renderer-backgrounding',
						'--disable-backgrounding-occluded-windows',
						'--disable-features=CalculateNativeWinOcclusion',
					],
				},
			},
		},
	],
})
