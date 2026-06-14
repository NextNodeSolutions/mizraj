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

vi.mock('@/app/router', () => ({
	navigate: vi.fn(),
	reviewHref: (file?: string) =>
		file === undefined
			? '/review'
			: `/review?file=${encodeURIComponent(file)}`,
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
			root.render(<DiffPanel repoPath="/repo" />)
		})
	}

	it('renders the dock with file rows and a unified preview', async () => {
		await mount()
		expect(container.innerHTML).toMatchInlineSnapshot(
			`"<aside class="panel fc-diffs" aria-label="Diffs"><header class="panel-head"><span class="grip" title="Drag to rearrange module" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><h3>Diffs</h3><span class="ph-count">1 files</span><span class="mz-spacer"></span><button type="button" class="btn btn-sm btn-outline">Open review ↗</button></header><div class="fc-dfiles"><button type="button" class="dfile" data-on="true"><span class="nm">foo.ts</span><span class="stat"><span class="add">+1</span> <span class="del">−1</span></span></button></div><div class="fc-dhunk"><div data-testid="file-diff-stub" data-file-name="foo.ts" data-diff-style="unified"></div></div></aside>"`,
		)
	})
})
