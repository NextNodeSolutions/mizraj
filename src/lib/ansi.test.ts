import { describe, expect, it } from 'vitest'

import { parseAnsiSegments } from './ansi'

describe('parseAnsiSegments', () => {
	it('returns a single segment with no styling when the text has no escapes', () => {
		expect(parseAnsiSegments('hello world')).toEqual([
			{
				content: 'hello world',
				fg: null,
				bg: null,
				bold: false,
				italic: false,
				underline: false,
			},
		])
	})

	it('returns an empty array for empty input', () => {
		expect(parseAnsiSegments('')).toEqual([])
	})

	it('extracts the foreground color from the SGR red escape', () => {
		const [segment] = parseAnsiSegments('\x1b[31mred\x1b[0m')

		expect(segment).toEqual({
			content: 'red',
			fg: 'rgb(187, 0, 0)',
			bg: null,
			bold: false,
			italic: false,
			underline: false,
		})
	})

	it('flags the bold decoration', () => {
		const [segment] = parseAnsiSegments('\x1b[1mloud\x1b[0m')

		expect(segment?.content).toBe('loud')
		expect(segment?.bold).toBe(true)
		expect(segment?.italic).toBe(false)
	})

	it('flags the italic decoration', () => {
		const [segment] = parseAnsiSegments('\x1b[3mlean\x1b[0m')

		expect(segment?.content).toBe('lean')
		expect(segment?.italic).toBe(true)
		expect(segment?.bold).toBe(false)
	})

	it('returns one segment per styled run when colors change mid-string', () => {
		const segments = parseAnsiSegments('\x1b[31mred\x1b[0m plain \x1b[32mgreen\x1b[0m')

		expect(segments.map(s => s.content)).toEqual(['red', ' plain ', 'green'])
		expect(segments.map(s => s.fg)).toEqual([
			'rgb(187, 0, 0)',
			null,
			'rgb(0, 187, 0)',
		])
	})

	it('keeps HTML metacharacters intact in segment content (React escapes them at render time)', () => {
		const [segment] = parseAnsiSegments('<script>alert(1)</script>')

		expect(segment?.content).toBe('<script>alert(1)</script>')
	})
})
