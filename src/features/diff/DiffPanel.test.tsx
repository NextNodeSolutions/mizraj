import { act } from 'react'
import type { JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, navigateMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	navigateMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@/app/router', () => ({
	navigate: navigateMock,
	reviewHref: (file?: string) =>
		file === undefined
			? '/review'
			: `/review?file=${encodeURIComponent(file)}`,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

type FileDiffStubProps = {
	fileDiff: { name: string }
	options: { diffStyle: string }
}

const FileDiffStub = vi.hoisted(
	() =>
		({ fileDiff, options }: FileDiffStubProps): JSX.Element => (
			<div
				data-testid="file-diff-stub"
				data-file-name={fileDiff.name}
				data-diff-style={options.diffStyle}
			/>
		),
)

vi.mock('@pierre/diffs/react', () => ({ FileDiff: FileDiffStub }))

import { DiffPanel } from './DiffPanel'

const TWO_FILE_PATCH = [
	'diff --git a/src/auth/session.ts b/src/auth/session.ts',
	'index 1111111..2222222 100644',
	'--- a/src/auth/session.ts',
	'+++ b/src/auth/session.ts',
	'@@ -1,2 +1,3 @@',
	' export const session = {}',
	'-export const old = 1',
	'+export const renewed = 2',
	'+export const added = 3',
	'diff --git a/README.md b/README.md',
	'index 3333333..4444444 100644',
	'--- a/README.md',
	'+++ b/README.md',
	'@@ -1,1 +1,1 @@',
	'-old line',
	'+new line',
	'',
].join('\n')

describe('DiffPanel dock', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		invokeMock.mockReset()
		navigateMock.mockReset()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
	})

	const mount = async (repoPath: string | null = '/repo'): Promise<void> => {
		await act(async () => {
			root.render(<DiffPanel repoPath={repoPath} />)
		})
	}

	const headCount = (): string | null | undefined =>
		container.querySelector('.panel-head .ph-count')?.textContent

	const openReview = (): HTMLButtonElement | null =>
		container.querySelector<HTMLButtonElement>(
			'.panel-head button.btn.btn-sm.btn-outline',
		)

	it('renders the dock head and the empty placeholder on a clean tree', async () => {
		invokeMock.mockResolvedValue({ patch: '' })
		await mount()

		expect(
			container.querySelector('.panel.fc-diffs .panel-head h3')
				?.textContent,
		).toBe('Diffs')
		expect(headCount()).toBe('0 files')
		expect(container.textContent).toContain('No changes.')
	})

	it('lists patch files with stats and previews the first one unified', async () => {
		invokeMock.mockResolvedValue({ patch: TWO_FILE_PATCH })
		await mount()

		expect(headCount()).toBe('2 files')

		const rows = Array.from(container.querySelectorAll('.fc-dfiles .dfile'))
		expect(rows.map(row => row.querySelector('.nm')?.textContent)).toEqual([
			'src/auth/session.ts',
			'README.md',
		])
		expect(rows.map(row => row.getAttribute('data-on'))).toEqual([
			'true',
			'false',
		])
		expect(rows[0]?.querySelector('.stat')?.textContent).toBe('+2 −1')

		const preview = container.querySelector(
			'.fc-dhunk [data-testid="file-diff-stub"]',
		)
		expect(preview?.getAttribute('data-file-name')).toBe(
			'src/auth/session.ts',
		)
		expect(preview?.getAttribute('data-diff-style')).toBe('unified')
	})

	it('selects a row on click and swaps the preview', async () => {
		invokeMock.mockResolvedValue({ patch: TWO_FILE_PATCH })
		await mount()

		const second =
			container.querySelectorAll<HTMLButtonElement>(
				'.fc-dfiles .dfile',
			)[1]
		act(() => {
			second?.click()
		})

		const rows = Array.from(container.querySelectorAll('.fc-dfiles .dfile'))
		expect(rows.map(row => row.getAttribute('data-on'))).toEqual([
			'false',
			'true',
		])
		expect(
			container
				.querySelector('.fc-dhunk [data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('README.md')
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it('opens the review preselected on the file when re-clicking the selected row', async () => {
		invokeMock.mockResolvedValue({ patch: TWO_FILE_PATCH })
		await mount()

		const first =
			container.querySelectorAll<HTMLButtonElement>(
				'.fc-dfiles .dfile',
			)[0]
		act(() => {
			first?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith(
			'/review?file=src%2Fauth%2Fsession.ts',
		)
	})

	it('carries the selected file into the head review link', async () => {
		invokeMock.mockResolvedValue({ patch: TWO_FILE_PATCH })
		await mount()

		const second =
			container.querySelectorAll<HTMLButtonElement>(
				'.fc-dfiles .dfile',
			)[1]
		act(() => {
			second?.click()
		})
		act(() => {
			openReview()?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith('/review?file=README.md')
	})

	it('opens the bare review when nothing is selected', async () => {
		invokeMock.mockResolvedValue({ patch: '' })
		await mount()

		act(() => {
			openReview()?.click()
		})

		expect(navigateMock).toHaveBeenCalledWith('/review')
	})

	it('idles without a repository', async () => {
		await mount(null)

		expect(headCount()).toBe('0 files')
		const placeholder = container.querySelector('[role="status"]')
		expect(placeholder?.textContent).toBe('No repository selected.')
	})

	it('announces the loading state politely', async () => {
		invokeMock.mockReturnValue(new Promise(() => {}))
		await mount()

		const placeholder = container.querySelector('[role="status"]')
		expect(placeholder?.textContent).toBe('Loading diff…')
		expect(placeholder?.getAttribute('aria-live')).toBe('polite')
	})

	it('alerts when the diff is unavailable', async () => {
		invokeMock.mockRejectedValue(new Error('git blew up'))
		await mount()

		expect(headCount()).toBe('0 files')
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			'Diff unavailable: git blew up',
		)
	})
})
