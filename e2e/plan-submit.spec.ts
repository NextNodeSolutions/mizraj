import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { startTestServer } from './test-server'
import type { TestServer } from './test-server'

const FIXTURE_HTML = fileURLToPath(
	new URL('./fixtures/plan.html', import.meta.url),
)
const SLUG = 'agent-cockpit'

type Ctx = {
	server: TestServer
	projectRoot: string
}

const ctx: Partial<Ctx> = {}

test.beforeAll(async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'agent-cockpit-e2e-'))
	const server = await startTestServer({
		projectRoot,
		fixtureHtmlPath: FIXTURE_HTML,
	})
	ctx.projectRoot = projectRoot
	ctx.server = server
})

test.afterAll(async () => {
	if (ctx.server) await ctx.server.close()
	if (ctx.projectRoot)
		await rm(ctx.projectRoot, { recursive: true, force: true })
})

test('open plan.html, click Submit, submission.json written to docs/interviews/<slug>/', async ({
	page,
}) => {
	if (!ctx.server || !ctx.projectRoot)
		throw new Error('test context not initialized')

	const url = `http://127.0.0.1:${ctx.server.port}/interview/${SLUG}/plan.html`
	await page.goto(url)

	await expect(page.locator('#title')).toHaveText('Fixture plan')
	const submit = page.locator('#submit')
	await expect(submit).toBeVisible()
	await expect(submit).toBeEnabled()

	await submit.click()
	await expect(page.locator('#status')).toHaveAttribute('data-state', 'ok')

	const expectedPath = join(
		ctx.projectRoot,
		'docs/interviews',
		SLUG,
		'submission.json',
	)
	const content = await readFile(expectedPath, 'utf8')
	const parsed: unknown = JSON.parse(content)
	expect(parsed).toEqual({ answers: { q1: 'yes', q2: 'maybe' } })
	expect(content.startsWith('{\n  ')).toBe(true)
})

test('plan kind writes to docs/plans/<slug>/submission.json', async ({
	page,
}) => {
	if (!ctx.server || !ctx.projectRoot)
		throw new Error('test context not initialized')

	const planSlug = '2026-05-22-fixture'
	const url = `http://127.0.0.1:${ctx.server.port}/plan/${planSlug}/plan.html`
	await page.goto(url)

	await page.locator('#submit').click()
	await expect(page.locator('#status')).toHaveAttribute('data-state', 'ok')

	const expectedPath = join(
		ctx.projectRoot,
		'docs/plans',
		planSlug,
		'submission.json',
	)
	const content = await readFile(expectedPath, 'utf8')
	expect(JSON.parse(content)).toEqual({ answers: { q1: 'yes', q2: 'maybe' } })
})
