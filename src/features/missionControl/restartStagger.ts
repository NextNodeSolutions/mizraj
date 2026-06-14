/**
 * Replays the `.stagger > *` entrance on already-mounted children without a
 * remount: clearing the animation, forcing one reflow, then restoring it makes
 * the browser run `riseIn` again. Lets a filter switch re-stagger the wall
 * while the resource-loading ProjectGroups stay mounted (no IPC re-fires).
 */
export const restartStagger = (container: HTMLElement | null): void => {
	if (container === null) return
	for (const child of Array.from(container.children)) {
		if (!(child instanceof HTMLElement)) continue
		child.style.animation = 'none'
		// Reading layout flushes the cleared animation before it is restored.
		void child.offsetWidth
		child.style.animation = ''
	}
}
