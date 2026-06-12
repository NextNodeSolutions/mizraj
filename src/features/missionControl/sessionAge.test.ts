import { describe, expect, it } from 'vitest'

import { formatSessionAge } from './sessionAge'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

describe('formatSessionAge', () => {
	it('shows seconds under a minute', () => {
		expect(formatSessionAge(12_000, 0)).toBe('12s')
	})

	it('shows minutes under an hour', () => {
		expect(formatSessionAge(4 * MINUTE_MS + 30_000, 0)).toBe('4m')
	})

	it('shows hours under a day', () => {
		expect(formatSessionAge(2 * HOUR_MS, 0)).toBe('2h')
	})

	it('shows days beyond', () => {
		expect(formatSessionAge(3 * DAY_MS + HOUR_MS, 0)).toBe('3d')
	})

	it('clamps a clock skew to zero seconds', () => {
		expect(formatSessionAge(0, 5_000)).toBe('0s')
	})
})
