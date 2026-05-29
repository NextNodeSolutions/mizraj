import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	appendOutputAtom,
	sessionsAtom,
	startSessionAtom,
} from '../../state/sessions'

const scrollToRowMock = vi.hoisted(() => vi.fn())

// Mocked at the system boundary (react-window) so jsdom layout limits don't
// suppress row rendering and so we can assert imperative scroll calls.
vi.mock('react-window', async () => {
	const React = await import('react')

	type RowComponent = React.ComponentType<{
		index: number
		style: React.CSSProperties
		lines: ReadonlyArray<{ text: string; kind: 'stdout' | 'stderr' }>
	}>

	type ListProps = {
		rowComponent: RowComponent
		rowCount: number
		rowProps: {
			lines: ReadonlyArray<{ text: string; kind: 'stdout' | 'stderr' }>
		}
		listRef?: React.Ref<{
			scrollToRow: typeof scrollToRowMock
			element: HTMLDivElement | null
		}>
		onScroll?: React.UIEventHandler<HTMLDivElement>
		className?: string
		style?: React.CSSProperties
	}

	const List = ({
		rowComponent: RowComponent,
		rowCount,
		rowProps,
		listRef,
		onScroll,
		className,
		style,
	}: ListProps): React.JSX.Element => {
		const innerRef = React.useRef<HTMLDivElement>(null)
		React.useImperativeHandle(
			listRef,
			() => ({
				scrollToRow: scrollToRowMock,
				get element() {
					return innerRef.current
				},
			}),
			[],
		)
		return (
			<div
				ref={innerRef}
				className={className}
				style={style}
				data-testid="agent-log-list"
				data-row-count={rowCount}
				onScroll={onScroll}
			>
				{rowProps.lines.slice(0, rowCount).map((line, position) => (
					<RowComponent
						key={`${line.kind}:${line.text}`}
						index={position}
						style={{}}
						lines={rowProps.lines}
					/>
				))}
			</div>
		)
	}

	const useListRef = (initial: unknown): React.RefObject<unknown> =>
		React.useRef(initial)

	return { List, useListRef }
})

import AgentLog from '../AgentLog'

const store = getDefaultStore()

describe('AgentLog', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		store.set(sessionsAtom, {})
		scrollToRowMock.mockClear()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => {
			root.unmount()
		})
		container.remove()
		vi.restoreAllMocks()
	})

	const mount = async (sessionId: string): Promise<void> => {
		await act(async () => {
			root.render(<AgentLog sessionId={sessionId} />)
		})
	}

	const list = (): HTMLElement => {
		const el = container.querySelector<HTMLElement>(
			'[data-testid="agent-log-list"]',
		)
		expect(el).not.toBeNull()
		if (el === null) expect.unreachable()
		return el
	}

	it('renders zero rows when the session has no output', async () => {
		store.set(startSessionAtom, 'sess-empty')
		await mount('sess-empty')
		expect(list().dataset.rowCount).toBe('0')
	})

	it('renders one row per chunk line', async () => {
		store.set(startSessionAtom, 'sess-lines')
		store.set(appendOutputAtom, {
			sessionId: 'sess-lines',
			chunk: { kind: 'stdout', text: 'first\nsecond\nthird\n' },
		})
		await mount('sess-lines')

		const el = list()
		expect(el.dataset.rowCount).toBe('3')
		const texts = Array.from(el.children).map(child => child.textContent)
		expect(texts).toEqual(['first', 'second', 'third'])
	})

	it('merges adjacent partial chunks into a single line until the newline arrives', async () => {
		store.set(startSessionAtom, 'sess-merge')
		store.set(appendOutputAtom, {
			sessionId: 'sess-merge',
			chunk: { kind: 'stdout', text: 'hel' },
		})
		store.set(appendOutputAtom, {
			sessionId: 'sess-merge',
			chunk: { kind: 'stdout', text: 'lo\nworld' },
		})
		await mount('sess-merge')

		const el = list()
		expect(el.dataset.rowCount).toBe('2')
		const texts = Array.from(el.children).map(child => child.textContent)
		expect(texts).toEqual(['hello', 'world'])
	})

	it('tags each line with the originating chunk kind', async () => {
		store.set(startSessionAtom, 'sess-kind')
		store.set(appendOutputAtom, {
			sessionId: 'sess-kind',
			chunk: { kind: 'stdout', text: 'out\n' },
		})
		store.set(appendOutputAtom, {
			sessionId: 'sess-kind',
			chunk: { kind: 'stderr', text: 'err\n' },
		})
		await mount('sess-kind')

		const el = list()
		const classNames = Array.from(el.children).map(child => child.className)
		expect(classNames).toEqual([
			'agent-log__line agent-log__line--stdout',
			'agent-log__line agent-log__line--stderr',
		])
	})

	it('grows the rendered row count when new chunks arrive via the store', async () => {
		store.set(startSessionAtom, 'sess-grow')
		store.set(appendOutputAtom, {
			sessionId: 'sess-grow',
			chunk: { kind: 'stdout', text: 'a\nb\n' },
		})
		await mount('sess-grow')
		expect(list().dataset.rowCount).toBe('2')

		await act(async () => {
			store.set(appendOutputAtom, {
				sessionId: 'sess-grow',
				chunk: { kind: 'stdout', text: 'c\nd\ne\n' },
			})
		})

		expect(list().dataset.rowCount).toBe('5')
	})

	it('auto-scrolls to the last row when chunks arrive while the user is at the bottom', async () => {
		store.set(startSessionAtom, 'sess-scroll')
		store.set(appendOutputAtom, {
			sessionId: 'sess-scroll',
			chunk: { kind: 'stdout', text: 'a\nb\n' },
		})
		await mount('sess-scroll')

		scrollToRowMock.mockClear()

		await act(async () => {
			store.set(appendOutputAtom, {
				sessionId: 'sess-scroll',
				chunk: { kind: 'stdout', text: 'c\nd\n' },
			})
		})

		expect(scrollToRowMock).toHaveBeenCalledTimes(1)
		expect(scrollToRowMock).toHaveBeenCalledWith({
			align: 'end',
			behavior: 'auto',
			index: 3,
		})
	})

	it('pauses auto-scroll after the user scrolls away from the bottom', async () => {
		store.set(startSessionAtom, 'sess-pause')
		store.set(appendOutputAtom, {
			sessionId: 'sess-pause',
			chunk: { kind: 'stdout', text: 'a\nb\n' },
		})
		await mount('sess-pause')

		const el = list()
		Object.defineProperty(el, 'scrollHeight', {
			configurable: true,
			value: 500,
		})
		Object.defineProperty(el, 'clientHeight', {
			configurable: true,
			value: 100,
		})
		Object.defineProperty(el, 'scrollTop', {
			configurable: true,
			value: 50,
		})

		await act(async () => {
			el.dispatchEvent(new Event('scroll', { bubbles: true }))
		})

		scrollToRowMock.mockClear()

		await act(async () => {
			store.set(appendOutputAtom, {
				sessionId: 'sess-pause',
				chunk: { kind: 'stdout', text: 'c\n' },
			})
		})

		expect(scrollToRowMock).not.toHaveBeenCalled()
	})
})
