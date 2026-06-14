import type { OptionAsAlt } from './ghosttyConfig'

type AltSideTracker = {
	/** Feed a keydown (down=true) / keyup (down=false) to track the Alt side. */
	track: (event: KeyboardEvent, down: boolean) => void
	/** Clear both sides — call on window blur (a key can release unseen). */
	reset: () => void
	/** Whether the Option side currently held acts as Alt/Meta. */
	altIsMeta: () => boolean
}

/**
 * Which Option side is physically down: KeyboardEvent.altKey can't say, so the
 * sides are tracked from the modifier's own keydown/keyup location and cleared
 * when the window blurs mid-press. Combined with macos-option-as-alt to decide
 * whether the held Option encodes as Alt/Meta or composes layout characters.
 */
export const createAltSideTracker = (
	optionAsAlt: () => OptionAsAlt,
): AltSideTracker => {
	let leftAltDown = false
	let rightAltDown = false
	const track = (event: KeyboardEvent, down: boolean): void => {
		if (event.key !== 'Alt') return
		if (event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT) {
			rightAltDown = down
		} else {
			leftAltDown = down
		}
	}
	const reset = (): void => {
		leftAltDown = false
		rightAltDown = false
	}
	const altIsMeta = (): boolean => {
		switch (optionAsAlt()) {
			case 'both':
				return true
			case 'left':
				return leftAltDown
			case 'right':
				return rightAltDown
			default:
				return false
		}
	}
	return { track, reset, altIsMeta }
}

type ComposerFocusSync = {
	/** Adopt focus into the composer when nothing interactive holds it. */
	sync: () => void
	/** Same, deferred a tick so it runs after the focus change settles. */
	syncSoon: () => void
}

/**
 * Focus follows the terminal: whenever focus lands on nothing (the body), the
 * composer adopts it so the next keystroke composes. Anything truly interactive
 * (palette, forms) keeps focus — the router defers to it — and the composer
 * reclaims on the way back.
 */
export const createComposerFocusSync = (
	composer: HTMLTextAreaElement,
	activeSessionId: () => string | null,
): ComposerFocusSync => {
	const sync = (): void => {
		const active = document.activeElement
		const idle = !active || active === document.body || active === composer
		if (idle && activeSessionId() !== null && active !== composer) {
			composer.focus({ preventScroll: true })
		}
	}
	const syncSoon = (): void => {
		setTimeout(sync, 0)
	}
	return { sync, syncSoon }
}
