import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { activeSessionIdAtom } from './sessions'
import {
	resetTerminalInputRouterForTests,
	startTerminalInputRouter,
} from './terminalInput'

const COMPOSER_LABEL = 'Terminal input'

const flushFocusSync = async (): Promise<void> => {
	await vi.advanceTimersByTimeAsync(0)
}

describe('terminal input router focus reclaim', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		getDefaultStore().set(activeSessionIdAtom, 'sess-1')
		startTerminalInputRouter()
	})

	afterEach(() => {
		// Tear the router down so the next beforeEach starts it fresh — the
		// once-guard otherwise no-ops every start after the first, leaking the
		// composer and document listeners across tests.
		resetTerminalInputRouterForTests()
		vi.useRealTimers()
		getDefaultStore().set(activeSessionIdAtom, null)
	})

	it('reclaims the composer when another field hands focus back to the body', async () => {
		const field = document.createElement('input')
		document.body.appendChild(field)
		field.focus()
		// Drain the sync scheduled by the composer losing focus to the field,
		// so the assertion below exercises the blur path alone.
		await flushFocusSync()
		expect(document.activeElement).toBe(field)

		// A keyboard-only dismissal (palette Escape, ⌘K toggle) blurs the field
		// without any click or window refocus — the composer must still adopt
		// focus so dead-key/IME input keeps flowing to the terminal.
		field.blur()
		await flushFocusSync()

		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			COMPOSER_LABEL,
		)

		field.remove()
	})

	it('leaves focus alone while an interactive element holds it', async () => {
		const first = document.createElement('input')
		const second = document.createElement('input')
		document.body.append(first, second)
		first.focus()

		second.focus()
		await flushFocusSync()

		expect(document.activeElement).toBe(second)

		first.remove()
		second.remove()
	})
})
