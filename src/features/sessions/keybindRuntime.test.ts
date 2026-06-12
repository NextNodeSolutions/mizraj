import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CellFramePayload, WireCell } from './terminalWire'

const { invokeMock, readClipboardMock, writeClipboardMock } = vi.hoisted(
	() => ({
		invokeMock: vi.fn(),
		readClipboardMock: vi.fn(),
		writeClipboardMock: vi.fn(),
	}),
)

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}))

vi.mock('./clipboard', () => ({
	readClipboardText: readClipboardMock,
	writeClipboardText: writeClipboardMock,
}))

vi.mock('@/shared/logger', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

import { cellFramesAtom } from './sessions'
import {
	executeKeybindAction,
	fontSizeDeltaAtom,
	sessionSelectionAtom,
} from './keybindRuntime'

const store = getDefaultStore()

const cell = (ch: string): WireCell => ({
	ch,
	fg: { kind: 'default' },
	bg: { kind: 'default' },
	attrs: 0,
	wide: 'narrow',
})

const frame: CellFramePayload = {
	session_id: 'sess-1',
	cols: 2,
	rows: 1,
	cells: [cell('h'), cell('i')],
	cursor: null,
	mouse_reporting: false,
	viewport_top: 0,
	history_total: 0,
}

const flushMicrotasks = async (): Promise<void> => {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

describe('executeKeybindAction', () => {
	beforeEach(() => {
		store.set(cellFramesAtom, { 'sess-1': frame })
		store.set(sessionSelectionAtom, {})
		invokeMock.mockReset().mockResolvedValue(undefined)
		readClipboardMock.mockReset()
		writeClipboardMock.mockReset().mockResolvedValue(undefined)
	})

	it('copy falls back to the visible grid when nothing is selected', () => {
		executeKeybindAction(
			{ kind: 'copy_to_clipboard' },
			{ sessionId: 'sess-1' },
		)

		expect(writeClipboardMock).toHaveBeenCalledWith('hi')
	})

	it('select_all records the grid as the session selection', () => {
		executeKeybindAction({ kind: 'select_all' }, { sessionId: 'sess-1' })

		expect(store.get(sessionSelectionAtom)['sess-1']).toBe('hi')
	})

	it('copy prefers the recorded selection', () => {
		store.set(sessionSelectionAtom, { 'sess-1': 'chosen text' })

		executeKeybindAction(
			{ kind: 'copy_to_clipboard' },
			{ sessionId: 'sess-1' },
		)

		expect(writeClipboardMock).toHaveBeenCalledWith('chosen text')
	})

	it('paste injects the clipboard into the PTY', async () => {
		readClipboardMock.mockResolvedValue('clip text')

		executeKeybindAction(
			{ kind: 'paste_from_clipboard' },
			{ sessionId: 'sess-1' },
		)
		await flushMicrotasks()

		expect(invokeMock).toHaveBeenCalledWith('session_paste', {
			sessionId: 'sess-1',
			text: 'clip text',
		})
	})

	it('an empty clipboard pastes nothing', async () => {
		readClipboardMock.mockResolvedValue(null)

		executeKeybindAction(
			{ kind: 'paste_from_clipboard' },
			{ sessionId: 'sess-1' },
		)
		await flushMicrotasks()

		expect(invokeMock).not.toHaveBeenCalled()
	})

	it('paste_from_selection prefers the recorded selection', async () => {
		store.set(sessionSelectionAtom, { 'sess-1': 'primary' })

		executeKeybindAction(
			{ kind: 'paste_from_selection' },
			{ sessionId: 'sess-1' },
		)
		await flushMicrotasks()

		expect(invokeMock).toHaveBeenCalledWith('session_paste', {
			sessionId: 'sess-1',
			text: 'primary',
		})
		expect(readClipboardMock).not.toHaveBeenCalled()
	})

	it('font-size steps accumulate into the delta and reset clears it', () => {
		store.set(fontSizeDeltaAtom, 0)

		executeKeybindAction(
			{ kind: 'increase_font_size', amount: 2 },
			{ sessionId: 'sess-1' },
		)
		executeKeybindAction(
			{ kind: 'increase_font_size', amount: 1 },
			{ sessionId: 'sess-1' },
		)
		expect(store.get(fontSizeDeltaAtom)).toBe(3)

		executeKeybindAction(
			{ kind: 'decrease_font_size', amount: 1.5 },
			{ sessionId: 'sess-1' },
		)
		expect(store.get(fontSizeDeltaAtom)).toBe(1.5)

		executeKeybindAction({ kind: 'reset_font_size' }, { sessionId: 'sess-1' })
		expect(store.get(fontSizeDeltaAtom)).toBe(0)
	})

	it('clear_screen sends a form feed to the PTY', () => {
		executeKeybindAction({ kind: 'clear_screen' }, { sessionId: 'sess-1' })

		expect(invokeMock).toHaveBeenCalledWith('session_write', {
			sessionId: 'sess-1',
			text: '\f',
		})
	})

	it('text payloads are written verbatim', () => {
		executeKeybindAction(
			{ kind: 'text', text: 'git status\n' },
			{ sessionId: 'sess-1' },
		)

		expect(invokeMock).toHaveBeenCalledWith('session_write', {
			sessionId: 'sess-1',
			text: 'git status\n',
		})
	})

	it('esc payloads are prefixed with ESC', () => {
		executeKeybindAction(
			{ kind: 'esc', sequence: 'b' },
			{ sessionId: 'sess-1' },
		)

		expect(invokeMock).toHaveBeenCalledWith('session_write', {
			sessionId: 'sess-1',
			text: 'b',
		})
	})

	it('reset resets the terminal emulator', () => {
		executeKeybindAction({ kind: 'reset' }, { sessionId: 'sess-1' })

		expect(invokeMock).toHaveBeenCalledWith('session_reset', {
			sessionId: 'sess-1',
		})
	})
})
