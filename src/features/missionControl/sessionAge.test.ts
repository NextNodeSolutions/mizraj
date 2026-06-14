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

	it('rolls over to minutes exactly at one minute', () => {
		expect(formatSessionAge(MINUTE_MS, 0)).toBe('1m')
	})

	it('still reads minutes one millisecond before the hour', () => {
		expect(formatSessionAge(HOUR_MS - 1, 0)).toBe('59m')
	})

	it('rolls over to days exactly at one day', () => {
		expect(formatSessionAge(DAY_MS, 0)).toBe('1d')
	})

	it('clamps a clock skew to zero seconds', () => {
		expect(formatSessionAge(0, 5_000)).toBe('0s')
	})
})
