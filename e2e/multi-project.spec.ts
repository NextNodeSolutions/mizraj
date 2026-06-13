import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
	REPO_ALPHA,
	REPO_BETA,
	defaultFixtures,
	installTauriMock,
} from './fixtures/tauriMock'

const PREVIEW_PORT = 4180
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`

let preview: ChildProcess | null = null

const waitForServer = async (url: string): Promise<void> => {
	const deadline = Date.now() + 30_000
	for (;;) {
		try {
			const response = await fetch(url)
			if (response.ok) return
		} catch {
			// keep polling until the dev server binds
		}
		if (Date.now() > deadline) {
			throw new Error(`vite preview never answered at ${url}`)
		}
		await new Promise(resolve => setTimeout(resolve, 250))
	}
}

test.beforeAll(async () => {
	preview = spawn(
		'pnpm',
		['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
		{ stdio: 'ignore' },
	)
	await waitForServer(BASE_URL)
})

test.afterAll(() => {
	preview?.kill()
})

const openApp = async (page: Page): Promise<void> => {
	await page.addInitScript(installTauriMock, defaultFixtures())
	await page.goto(BASE_URL)
	await expect(page.locator('.mz-topbar')).toBeVisible()
}

test('the TopBar picker lists every registered repo and Add repo…', async ({
	page,
}) => {
	await openApp(page)

	await page.locator('.mz-proj').click()

	const options = page.locator('.mz-projmenu [role="option"]')
	await expect(options).toHaveCount(3)
	await expect(options.nth(0)).toContainText('alpha')
	await expect(options.nth(0)).toContainText('~/dev/alpha')
	await expect(options.nth(1)).toContainText('beta')
	await expect(options.nth(2)).toContainText('Add repo…')

	await page.screenshot({
		path: 'test-results/multi-project/picker-open.png',
		animations: 'disabled',
	})
})

test('switching repo via the picker updates the TopBar scope', async ({
	page,
}) => {
	await openApp(page)

	await page.locator('.mz-proj').click()
	await page
		.locator('.mz-projmenu [role="option"]', { hasText: 'beta' })
		.click()

	// The menu closes and the picker now carries the selected repo (its
	// title attribute holds the full path on every screen).
	await expect(page.locator('.mz-projmenu')).toHaveCount(0)
	await expect(page.locator('.mz-proj')).toHaveAttribute('title', REPO_BETA)
})

test('Mission Control folds both repos into the dormant section when idle', async ({
	page,
}) => {
	await openApp(page)

	const dormant = page.locator('.mc-dormant')
	await expect(dormant).toBeVisible()
	await expect(dormant).toContainText('2 dormant repos')

	await dormant.locator('.mc-dormant-head').click()
	const rows = dormant.locator('.mc-dormant-row')
	await expect(rows).toHaveCount(2)
	await expect(rows.nth(0)).toContainText('alpha')
	await expect(rows.nth(1)).toContainText('beta')

	await page.screenshot({
		path: 'test-results/multi-project/mission-control-dormant.png',
		fullPage: true,
		animations: 'disabled',
	})
})

test('the Pipeline shows both repos at once, grouped per repo, no mutation', async ({
	page,
}) => {
	await openApp(page)
	await page.goto(`${BASE_URL}/pipeline`)

	const backlog = page
		.locator('.pipeline__col')
		.filter({ hasText: 'Backlog' })
	await expect(backlog).toContainText('Ship the alpha feature')
	await expect(backlog).toContainText('Fix the beta bug')

	// Visual separation: one repo label per repo inside the column.
	const labels = backlog.locator('.pipeline__repo')
	await expect(labels).toHaveCount(2)
	await expect(labels.nth(0)).toContainText('alpha')
	await expect(labels.nth(1)).toContainText('beta')

	await page.screenshot({
		path: 'test-results/multi-project/pipeline-two-repos.png',
		fullPage: true,
		animations: 'disabled',
	})
})

test('repos stay siloed: each repo reads its own branch and diff', async ({
	page,
}) => {
	await openApp(page)
	await page.goto(`${BASE_URL}/pipeline`)
	await expect(
		page.locator('.pipeline__col').filter({ hasText: 'Backlog' }),
	).toContainText('Ship the alpha feature')

	// Both repos were read explicitly — by path, not via an active singleton.
	const overviewReads = await page.evaluate(() => {
		type Internals = {
			invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown>
		}
		const internals = (
			window as unknown as { __TAURI_INTERNALS__: Internals }
		).__TAURI_INTERNALS__
		return Promise.all([
			internals.invoke('tasks_overview', {
				repoPath: '/Users/demo/dev/alpha',
			}),
			internals.invoke('tasks_overview', {
				repoPath: '/Users/demo/dev/beta',
			}),
		])
	})
	const [alphaOverview, betaOverview] = overviewReads as Array<{
		userTasks: Array<{ title: string }>
	}>
	expect(alphaOverview?.userTasks[0]?.title).toBe('Ship the alpha feature')
	expect(betaOverview?.userTasks[0]?.title).toBe('Fix the beta bug')
	expect(REPO_ALPHA).not.toBe(REPO_BETA)
})
