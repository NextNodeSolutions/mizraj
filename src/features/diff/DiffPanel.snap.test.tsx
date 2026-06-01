import { act } from 'react'
import type { JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
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

import DiffPanel from './DiffPanel'

const FIXTURE_PATCH = [
	'diff --git a/foo.ts b/foo.ts',
	'index 0000000..1111111 100644',
	'--- a/foo.ts',
	'+++ b/foo.ts',
	'@@ -1,1 +1,1 @@',
	'-old',
	'+new',
	'',
].join('\n')

describe('DiffPanel snapshot', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		invokeMock.mockResolvedValue({ patch: FIXTURE_PATCH })
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

	const mount = async (): Promise<void> => {
		await act(async () => {
			root.render(<DiffPanel />)
		})
	}

	it('renders the split layout (default)', async () => {
		await mount()
		expect(container.innerHTML).toMatchInlineSnapshot(
			`"<div class="diff-panel"><div class="diff-panel__toolbar" role="toolbar" aria-label="Diff panel"><button type="button" class="diff-panel__layout-toggle" aria-pressed="false">Stacked view</button></div><div class="diff-panel__container"><div data-testid="file-diff-stub" data-file-name="foo.ts" data-diff-style="split"></div></div></div>"`,
		)
	})

	it('renders the stacked layout after toggling', async () => {
		await mount()
		const toggle = container.querySelector<HTMLButtonElement>(
			'.diff-panel__layout-toggle',
		)
		expect(toggle).not.toBeNull()
		await act(async () => {
			toggle?.click()
		})
		expect(container.innerHTML).toMatchInlineSnapshot(
			`"<div class="diff-panel"><div class="diff-panel__toolbar" role="toolbar" aria-label="Diff panel"><button type="button" class="diff-panel__layout-toggle" aria-pressed="true">Split view</button></div><div class="diff-panel__container"><div data-testid="file-diff-stub" data-file-name="foo.ts" data-diff-style="unified"></div></div></div>"`,
		)
	})
})
