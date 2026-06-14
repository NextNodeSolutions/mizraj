import { useEffect } from 'react'

import type { ReviewFile } from './reviewFiles'

const isTextEntry = (node: Element | null): boolean =>
	node instanceof HTMLElement &&
	(node.tagName === 'TEXTAREA' ||
		node.tagName === 'INPUT' ||
		node.isContentEditable)

// Tab → next changed file, Shift+Tab → previous (wrapping). Suppressed while
// the composer (or any text field) holds focus, so writing a remark keeps Tab's
// normal behavior. Rapid Tab presses ride the same deferred path as clicks.
export const useFileKeyboardNav = (
	files: ReadonlyArray<ReviewFile>,
	currentPath: string | null,
	selectFile: (path: string) => void,
): void => {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (
				event.key !== 'Tab' ||
				event.altKey ||
				event.metaKey ||
				event.ctrlKey ||
				files.length === 0 ||
				isTextEntry(document.activeElement)
			) {
				return
			}
			event.preventDefault()
			const current = files.findIndex(file => file.path === currentPath)
			const base = current === -1 ? 0 : current
			const step = event.shiftKey ? -1 : 1
			const target = files[(base + step + files.length) % files.length]
			if (target !== undefined) selectFile(target.path)
		}
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [files, currentPath, selectFile])
}
