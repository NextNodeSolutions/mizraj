import Anser from 'anser'

export type AnsiSegment = {
	content: string
	fg: string | null
	bg: string | null
	bold: boolean
	italic: boolean
	underline: boolean
}

const toCssColor = (raw: string | null | undefined): string | null => {
	if (raw === null || raw === undefined || raw === '') return null
	return `rgb(${raw})`
}

export const parseAnsiSegments = (text: string): AnsiSegment[] => {
	if (text === '') return []
	const entries = Anser.ansiToJson(text, {
		json: true,
		remove_empty: true,
		use_classes: false,
	})
	return entries
		.filter(entry => entry.content !== '')
		.map(entry => ({
			content: entry.content,
			fg: toCssColor(entry.fg),
			bg: toCssColor(entry.bg),
			bold: entry.decorations.includes('bold'),
			italic: entry.decorations.includes('italic'),
			underline: entry.decorations.includes('underline'),
		}))
}
