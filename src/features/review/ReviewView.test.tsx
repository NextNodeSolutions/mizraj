import { getDefaultStore } from 'jotai'
import { act } from 'react'
import type { JSX, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

// A capturing appFocus stub so a test can fire a window-focus reload on demand
// (the real bridge is driven by Tauri, unreachable from jsdom). useDiff's
// reload-on-focus then re-fetches get_diff and re-parses the patch.
const { focusSubscribers, fireAppFocus } = vi.hoisted(() => {
	const subscribers = new Set<() => void>()
	return {
		focusSubscribers: subscribers,
		fireAppFocus: (): void => {
			for (const notify of subscribers) notify()
		},
	}
})

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

vi.mock('@/shared/appFocus', () => ({
	onAppFocus: (onFocus: () => void): (() => void) => {
		focusSubscribers.add(onFocus)
		return () => {
			focusSubscribers.delete(onFocus)
		}
	},
	resetAppFocusForTests: (): void => {
		focusSubscribers.clear()
	},
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

// The stub exposes the library contract the view relies on: the hovered-line
// gutter slot (hovering line 2 of the additions side) and the annotation
// render path.
vi.mock('@pierre/diffs/react', () => {
	type HoveredLine = { lineNumber: number; side: 'additions' | 'deletions' }
	type StubAnnotation = {
		side: 'additions' | 'deletions'
		lineNumber: number
		metadata: { id: number }
	}
	type StubProps = {
		fileDiff: { name: string }
		options: { diffStyle: string }
		lineAnnotations?: ReadonlyArray<StubAnnotation>
		renderAnnotation?: (annotation: StubAnnotation) => ReactNode
		renderGutterUtility?: (
			getHoveredLine: () => HoveredLine | undefined,
		) => ReactNode
	}
	const FileDiff = ({
		fileDiff,
		options,
		lineAnnotations,
		renderAnnotation,
		renderGutterUtility,
	}: StubProps): JSX.Element => (
		<div
			data-testid="file-diff-stub"
			data-file-name={fileDiff.name}
			data-diff-style={options.diffStyle}
		>
			<div data-testid="gutter-utility">
				{renderGutterUtility?.(() => ({
					lineNumber: 2,
					side: 'additions',
				}))}
			</div>
			<div data-testid="annotations">
				{lineAnnotations?.map(annotation => (
					<div
						key={annotation.metadata.id}
						data-annotation-line={annotation.lineNumber}
						data-annotation-side={annotation.side}
					>
						{renderAnnotation?.(annotation)}
					</div>
				))}
			</div>
		</div>
	)
	return { FileDiff }
})

import { navigate, reviewHref } from '@/app/router'
import {
	cellFramesAtom,
	sessionsAtom,
	setCellFrameAtom,
	startSessionAtom,
} from '@/features/sessions/sessions'
import type { CellFramePayload } from '@/features/sessions/terminalWire'
import { toastsAtom } from '@/shared/toasts'

import { conversationsAtom } from './agentConversation'
import { ReviewView } from './ReviewView'
import { viewedFilesAtom } from './viewedFiles'

const store = getDefaultStore()

const frameFor = (sessionId: string, text: string): CellFramePayload => ({
	session_id: sessionId,
	cols: [...text].length,
	rows: 1,
	cells: [...text].map(ch => ({
		ch,
		fg: { kind: 'default' },
		bg: { kind: 'default' },
		attrs: 0,
		wide: 'narrow',
	})),
	cursor: null,
	mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
})

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
		store.set(cellFramesAtom, {})
		store.set(viewedFilesAtom, {})
		store.set(conversationsAtom, {})
		store.set(toastsAtom, [])
		focusSubscribers.clear()
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
		window.history.pushState({}, '', '/')
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

	it('shows the review status dot and diff totals in the header', async () => {
		await render()

		const head = container.querySelector('.review__top')
		expect(head?.querySelector('.sdot.sdot-rev')).not.toBeNull()
		const stat = head?.querySelector('.stat')
		expect(stat?.textContent).toContain('+3')
		expect(stat?.textContent).toContain('−1')
		expect(stat?.textContent).toContain('· 2 files')
	})

	it('heads the diff pane with the selected file and its own viewed toggle', async () => {
		await render()

		const head = container.querySelector('.review__diff-head')
		expect(head?.textContent).toContain('src/api/limiter.ts')
		expect(head?.textContent).toContain('Viewed')
		expect(
			head?.querySelector('.review-tree__badge[data-change="added"]')
				?.textContent,
		).toBe('A')

		const check = head?.querySelector<HTMLButtonElement>(
			'button[aria-label="Mark src/api/limiter.ts viewed"]',
		)
		expect(check).not.toBeNull()
		await act(async () => {
			check?.click()
		})
		expect(container.textContent).toContain('1 / 2 viewed')
	})

	it('switches the diff to a clicked file', async () => {
		await render()

		const rows =
			container.querySelectorAll<HTMLElement>('.review-tree__file')
		await act(async () => {
			rows[1]?.click()
		})

		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/handler.ts')
	})

	it('lays the tree, diff and rail out as three staggered panels', async () => {
		await render()

		const body = container.querySelector('.review__body.stagger')
		expect(body).not.toBeNull()
		expect(body?.querySelectorAll(':scope > .panel')).toHaveLength(3)
	})

	it('viewed check buttons advance the progress bar', async () => {
		await render()

		expect(container.textContent).toContain('0 / 2 viewed')
		const check = container.querySelector<HTMLButtonElement>(
			'.review-tree__row button[aria-label="Mark src/api/limiter.ts viewed"]',
		)
		expect(check?.getAttribute('data-done')).toBe('false')
		await act(async () => {
			check?.click()
		})

		expect(container.textContent).toContain('1 / 2 viewed')
		expect(check?.getAttribute('data-done')).toBe('true')
	})

	it('marking a file viewed does not change the selected file', async () => {
		await render()

		const check = container.querySelector<HTMLButtonElement>(
			'.review-tree__row button[aria-label="Mark src/api/handler.ts viewed"]',
		)
		expect(check).not.toBeNull()
		await act(async () => {
			check?.click()
		})

		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/limiter.ts')
	})

	it('summarizes the working tree in the rail card', async () => {
		await render()

		const summary = container.querySelector('.review-rail__summary')
		expect(summary?.querySelector('h4')?.textContent).toBe(
			'WHAT THE AGENT DID',
		)
		expect(summary?.textContent).toContain(
			'2 files · +3 −1 in the working tree',
		)
		expect(container.querySelector('.review-rail__tail')).toBeNull()
	})

	it('appends the picked agent terminal tail when a frame is cached', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		store.set(setCellFrameAtom, frameFor('agent-1', '✓ build passed'))
		await render()

		expect(
			container.querySelector('.review-rail__tail')?.textContent,
		).toContain('✓ build passed')
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
		const message = container.querySelector(
			'.review-rail__thread .review-rail__msg',
		)
		expect(message?.getAttribute('data-me')).toBe('true')
		expect(message?.querySelector('.who')?.textContent).toContain('You')
		expect(message?.querySelector('.ref')?.textContent).toBe(
			'src/api/limiter.ts',
		)
		expect(message?.querySelector('.txt')?.textContent).toBe(
			'gère aussi le cas null',
		)
		// The design drops the thread heading; a11y keeps the aria-label.
		expect(container.querySelector('.review-rail__thread h4')).toBeNull()
		expect(textarea?.value).toBe('')
	})

	it('submits the draft with Cmd+Enter from the composer', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		const textarea = container.querySelector('textarea')
		expect(textarea?.placeholder).toBe(
			'Ask the agent for a change… (e.g. handle the null case too)',
		)
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				'value',
			)?.set
			setter?.call(textarea, 'ship it')
			textarea?.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(async () => {
			textarea?.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					metaKey: true,
					bubbles: true,
					cancelable: true,
				}),
			)
		})

		expect(invokeMock).toHaveBeenCalledWith('session_paste', {
			sessionId: 'agent-1',
			text: '[src/api/limiter.ts] ship it',
		})
	})

	it('request changes focuses the composer and prompts via toast', async () => {
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
		expect(store.get(toastsAtom).map(toast => toast.message)).toContain(
			'Describe the change you want from the agent',
		)
	})

	it('renders approve & merge disabled until a merge backend exists', async () => {
		await render()

		const approve = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Approve & merge'))
		expect(approve?.disabled).toBe(true)
		expect(approve?.title).toBe('Merge backend not wired yet')
	})

	it('+ comment arms the composer on the hovered line', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		const add =
			container.querySelector<HTMLButtonElement>('.review__cmt-add')
		expect(add?.textContent).toBe('+ comment')
		await act(async () => {
			add?.click()
		})

		expect(document.activeElement).toBe(container.querySelector('textarea'))
		expect(container.querySelector('.review-rail__ctx')?.textContent).toBe(
			'↳ src/api/limiter.ts · line 2',
		)
		expect(store.get(toastsAtom).map(toast => toast.message)).toContain(
			'Comment the line, then send to agent',
		)
	})

	it('anchors a sent line comment as an inline annotation card', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('.review__cmt-add')
				?.click()
		})
		const textarea = container.querySelector('textarea')
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				'value',
			)?.set
			setter?.call(textarea, 'gère le cas null ici')
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
			text: '[src/api/limiter.ts:2] gère le cas null ici',
		})
		const annotation = container.querySelector(
			'[data-testid="annotations"] [data-annotation-line="2"]',
		)
		const card = annotation?.querySelector('.review__inline-cmt')
		expect(annotation?.getAttribute('data-annotation-side')).toBe(
			'additions',
		)
		expect(card?.querySelector('.who')?.textContent).toBe('You · line 2')
		expect(card?.querySelector('.txt')?.textContent).toBe(
			'gère le cas null ici',
		)
		expect(card?.textContent).toContain('↻ sent to agent')
	})

	it('resets the compose context to the newly selected file', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('.review__cmt-add')
				?.click()
		})
		expect(container.querySelector('.review-rail__ctx')?.textContent).toBe(
			'↳ src/api/limiter.ts · line 2',
		)

		const rows =
			container.querySelectorAll<HTMLElement>('.review-tree__file')
		await act(async () => {
			rows[1]?.click()
		})

		expect(container.querySelector('.review-rail__ctx')?.textContent).toBe(
			'↳ src/api/handler.ts',
		)
	})

	it('preselects the deep-linked file from the route search', async () => {
		window.history.pushState({}, '', reviewHref('src/api/handler.ts'))
		await render()

		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/handler.ts')
		expect(
			container.querySelector('.review-tree__file[aria-current="true"]')
				?.textContent,
		).toContain('handler.ts')
	})

	it('follows a review deep link while mounted', async () => {
		await render()
		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/limiter.ts')

		await act(async () => {
			navigate(reviewHref('src/api/handler.ts'))
		})

		expect(
			container
				.querySelector('[data-testid="file-diff-stub"]')
				?.getAttribute('data-file-name'),
		).toBe('src/api/handler.ts')
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

	const fileDiffName = (): string | null | undefined =>
		container
			.querySelector('[data-testid="file-diff-stub"]')
			?.getAttribute('data-file-name')

	const pressTab = async (shiftKey = false): Promise<void> => {
		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Tab',
					shiftKey,
					bubbles: true,
					cancelable: true,
				}),
			)
		})
	}

	it('moves to the next file with Tab, wrapping past the last', async () => {
		await render()
		expect(fileDiffName()).toBe('src/api/limiter.ts')

		await pressTab()
		expect(fileDiffName()).toBe('src/api/handler.ts')

		await pressTab()
		expect(fileDiffName()).toBe('src/api/limiter.ts')
	})

	it('moves to the previous file with Shift+Tab, wrapping past the first', async () => {
		await render()

		await pressTab(true)
		expect(fileDiffName()).toBe('src/api/handler.ts')
	})

	it('leaves Tab alone while the composer is focused', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		const textarea = container.querySelector('textarea')
		await act(async () => {
			textarea?.focus()
		})
		await pressTab()

		// Focus stayed in the composer, so Tab kept its default behavior and the
		// selected file did not change.
		expect(fileDiffName()).toBe('src/api/limiter.ts')
	})

	it('falls back to the first file when the deep link names an absent path, and Tab still advances', async () => {
		window.history.pushState({}, '', reviewHref('src/api/ghost.ts'))
		await render()

		// The requested path is not in the parsed patch, so the first file shows.
		expect(fileDiffName()).toBe('src/api/limiter.ts')
		expect(
			container.querySelector('.review-tree__file[aria-current="true"]')
				?.textContent,
		).toContain('limiter.ts')

		// Tab navigation is unaffected by the dropped deep link.
		await pressTab()
		expect(fileDiffName()).toBe('src/api/handler.ts')
	})

	it('drops a stale line annotation once a reload removes its line from the diff', async () => {
		store.set(startSessionAtom, {
			id: 'agent-1',
			binary: 'claude',
			repoPath: '/repo',
		})
		await render()

		// Arm and send a line comment on limiter.ts line 2 (the stub hovers it).
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('.review__cmt-add')
				?.click()
		})
		const textarea = container.querySelector('textarea')
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				'value',
			)?.set
			setter?.call(textarea, 'gère le cas null ici')
			textarea?.dispatchEvent(new Event('input', { bubbles: true }))
		})
		const send = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button'),
		).find(button => button.textContent?.includes('Send to agent'))
		await act(async () => {
			send?.click()
		})

		expect(
			container.querySelector(
				'[data-testid="annotations"] [data-annotation-line="2"]',
			),
		).not.toBeNull()

		// The agent edits the file: the reloaded patch reshapes limiter.ts so its
		// only hunk now starts at line 5 — line 2 is no longer present.
		const RELOADED = [
			'diff --git a/src/api/limiter.ts b/src/api/limiter.ts',
			'index 3f1e2d4..4a2b3c5 100644',
			'--- a/src/api/limiter.ts',
			'+++ b/src/api/limiter.ts',
			'@@ -4,1 +4,2 @@',
			' const ttl = 60',
			'+export const rateLimit = () => {}',
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
		invokeMock.mockImplementation((command: string) =>
			command === 'get_diff'
				? Promise.resolve({ patch: RELOADED })
				: Promise.resolve(undefined),
		)
		await act(async () => {
			fireAppFocus()
		})

		// The thread still holds the message (the comment text survives), but its
		// annotation no longer maps to a present line, so the card is dropped.
		expect(store.get(conversationsAtom)['/repo']).toHaveLength(1)
		expect(
			container.querySelector(
				'[data-testid="annotations"] [data-annotation-line="2"]',
			),
		).toBeNull()
	})
})
