import { getDefaultStore } from 'jotai'
import { act } from 'react'
import type { JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock('@pierre/diffs/react', () => {
	type StubProps = {
		fileDiff: { name: string }
		options: { diffStyle: string }
	}
	const FileDiff = ({ fileDiff, options }: StubProps): JSX.Element => (
		<div
			data-testid="file-diff-stub"
			data-file-name={fileDiff.name}
			data-diff-style={options.diffStyle}
		/>
	)
	return { FileDiff }
})

import { sessionsAtom, startSessionAtom } from '@/features/sessions/sessions'

import { conversationsAtom } from './agentConversation'
import { ReviewView } from './ReviewView'
import { viewedFilesAtom } from './viewedFiles'

const store = getDefaultStore()

const PATCH = [
	'diff --git a/src/api/limiter.ts b/src/api/limiter.ts',
	'new file mode 100644',
	'index 0000000..3f1e2d4',
	'--- /dev/null',
	'+++ b/src/api/limiter.ts',
	'@@ -0,0 +1,2 @@',
	'+export const rateLimit = () => {}',
	'+export default rateLimit',
	'diff --git a/src/api/handler.ts b/src/api/handler.ts',
	'index 1111111..2222222 100644',
	'--- a/src/api/handler.ts',
	'+++ b/src/api/handler.ts',
	'@@ -1,2 +1,2 @@',
	' import { router } from "./router"',
	'-router.post("/send", send)',
	'+router.use(rateLimit())',
	'',
].join('\n')

describe('ReviewView', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		store.set(viewedFilesAtom, {})
		store.set(conversationsAtom, {})
		invokeMock.mockReset()
		invokeMock.mockImplementation((command: string) =>
			command === 'get_diff'
				? Promise.resolve({ patch: PATCH })
				: Promise.resolve(undefined),
		)
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

	const render = async (repoPath: string | null = '/repo'): Promise<void> => {
		await act(async () => {
			root.render(<ReviewView activeProjectPath={repoPath} />)
		})
	}

	it('lists every changed file with stats and selects the first by default', async () => {
		await render()

		const rows = container.querySelectorAll('.review-tree__file')
		expect(rows).toHaveLength(2)
		expect(rows[0]?.textContent).toContain('limiter.ts')
		expect(rows[0]?.textContent).toContain('+2')
		expect(rows[0]?.getAttribute('aria-current')).toBe('true')
		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/limiter.ts')
	})

	it('switches the diff to a clicked file', async () => {
		await render()

		const rows = container.querySelectorAll<HTMLElement>(
			'.review-tree__select',
		)
		await act(async () => {
			rows[1]?.click()
		})

		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/handler.ts')
	})

	it('viewed checkboxes advance the progress bar', async () => {
		await render()

		expect(container.textContent).toContain('0 / 2 viewed')
		const checkbox = container.querySelector<HTMLInputElement>(
			'.review-tree__file input[type="checkbox"]',
		)
		await act(async () => {
			checkbox?.click()
		})

		expect(container.textContent).toContain('1 / 2 viewed')
	})

	it('disables the composer without a running session in the repo', async () => {
		await render()

		const textarea = container.querySelector('textarea')
		expect(textarea?.disabled).toBe(true)
		expect(container.textContent).toContain('No running agent')
	})

	it('sends a remark to the running agent and records it in the thread', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		const textarea = container.querySelector('textarea')
		expect(textarea?.disabled).toBe(false)
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				'value',
			)?.set
			setter?.call(textarea, 'gère aussi le cas null')
			textarea?.dispatchEvent(new Event('input', { bubbles: true }))
		})
		const send = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Send to agent'))
		await act(async () => {
			send?.click()
		})

		expect(invokeMock).toHaveBeenCalledWith('session_paste', {
			sessionId: 'agent-1',
			text: '[src/api/limiter.ts] gère aussi le cas null',
		})
		expect(invokeMock).toHaveBeenCalledWith('session_write', {
			sessionId: 'agent-1',
			text: '\r',
		})
		expect(
			container.querySelector('.review-rail__thread')?.textContent,
		).toContain('gère aussi le cas null')
		expect(textarea?.value).toBe('')
	})

	it('request changes focuses the composer', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		const request = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Request changes'))
		await act(async () => {
			request?.click()
		})

		expect(document.activeElement).toBe(container.querySelector('textarea'))
	})

	it('reports a clean working tree', async () => {
		invokeMock.mockImplementation((command: string) =>
			command === 'get_diff'
				? Promise.resolve({ patch: '' })
				: Promise.resolve(undefined),
		)
		await render()

		expect(container.textContent).toContain('No changes')
	})
})
