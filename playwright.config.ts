import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: {
		trace: 'on-first-retry',
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
