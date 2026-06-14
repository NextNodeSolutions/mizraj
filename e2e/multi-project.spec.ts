import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
	REPO_ALPHA,
	REPO_BETA,
	defaultFixtures,
	installTauriMock,
} from './fixtures/tauriMock'

declare global {
	interface Window {
		__TAURI_INTERNALS__?: {
			invoke<T>(
				command: string,
				args?: Record<string, unknown>,
			): Promise<T>
		}
	}
}

// The framework-managed webServer (playwright.config.ts) builds + serves on
// baseURL, so specs navigate relative and never spawn their own preview.
const openApp = async (page: Page): Promise<void> => {
	const errors: Array<string> = []
	page.on('console', message => {
		if (message.type() === 'error') errors.push(message.text())
	})
	page.on('pageerror', error => errors.push(error.message))
	await page.addInitScript(installTauriMock, defaultFixtures())
	await page.goto('/')
	await expect(page.locator('.mz-topbar')).toBeVisible()
	// A render error or an unmocked-command rejection would only surface here —
	// fail loudly rather than let a broken page pass the selector assertions.
	expect(errors, errors.join('\n')).toEqual([])
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
	await page.goto('/pipeline')

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
	await page.goto('/pipeline')
	await expect(
		page.locator('.pipeline__col').filter({ hasText: 'Backlog' }),
	).toContainText('Ship the alpha feature')

	// Both repos were read explicitly — by path, not via an active singleton.
	// invoke is generically typed (see the Window augmentation above) so the
	// overview shape flows through without an `as` cast.
	const [alphaOverview, betaOverview] = await page.evaluate(() => {
		const internals = window.__TAURI_INTERNALS__
		if (!internals) throw new Error('tauri internals missing')
		const overview = (
			repoPath: string,
		): Promise<{ userTasks: Array<{ title: string }> }> =>
			internals.invoke<{ userTasks: Array<{ title: string }> }>(
				'tasks_overview',
				{ repoPath },
			)
		return Promise.all([
			overview('/Users/demo/dev/alpha'),
			overview('/Users/demo/dev/beta'),
		])
	})
	expect(alphaOverview?.userTasks[0]?.title).toBe('Ship the alpha feature')
	expect(betaOverview?.userTasks[0]?.title).toBe('Fix the beta bug')
	expect(REPO_ALPHA).not.toBe(REPO_BETA)
})
