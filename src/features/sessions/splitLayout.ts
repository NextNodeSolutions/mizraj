import { listen } from '@tauri-apps/api/event'
import { atom, getDefaultStore } from 'jotai'

import { describeError } from '@/shared/errors'
import { logger } from '@/shared/logger'

import type { SplitDirection, SplitFocus } from './ghosttyConfig'
import { activeSessionIdAtom, AGENT_END_EVENT } from './sessions'
import type { SessionEndPayload } from './sessions'

// A view's pane arrangement: a binary tree whose leaves are sessions. `row`
// lays children side by side (new_split:right), `column` stacks them
// (new_split:down). Ratios are fixed 50/50 — resize_split is out of scope.
export type SplitOrientation = 'row' | 'column'

export type SplitNode =
	| { kind: 'leaf'; sessionId: string }
	| {
			kind: 'split'
			orientation: SplitOrientation
			children: readonly [SplitNode, SplitNode]
	  }

export const leaf = (sessionId: string): SplitNode => ({
	kind: 'leaf',
	sessionId,
})

// One tree per routed view, keyed by the view's root session id. A view with
// no entry is the implicit single leaf of its root session.
export const splitTreesAtom = atom<Readonly<Record<string, SplitNode>>>({})

export const leavesOf = (node: SplitNode): string[] =>
	node.kind === 'leaf'
		? [node.sessionId]
		: [...leavesOf(node.children[0]), ...leavesOf(node.children[1])]

export const containsLeaf = (node: SplitNode, sessionId: string): boolean =>
	leavesOf(node).includes(sessionId)

// The key of the tree holding `sessionId`, when any view has split it in.
export const findRootId = (
	trees: Readonly<Record<string, SplitNode>>,
	sessionId: string,
): string | null =>
	Object.keys(trees).find(rootId =>
		containsLeaf(trees[rootId] ?? leaf(rootId), sessionId),
	) ?? null

// Replace the target leaf with a split of (target, new pane), the new pane on
// the side the direction names. `auto` opens to the right — the pane's pixel
// aspect isn't known at this level, and side-by-side is the common intent.
export const insertSplit = (
	node: SplitNode,
	targetSessionId: string,
	newSessionId: string,
	direction: SplitDirection,
): SplitNode => {
	if (node.kind === 'leaf') {
		if (node.sessionId !== targetSessionId) return node
		const fresh = leaf(newSessionId)
		switch (direction) {
			case 'left':
				return {
					kind: 'split',
					orientation: 'row',
					children: [fresh, node],
				}
			case 'up':
				return {
					kind: 'split',
					orientation: 'column',
					children: [fresh, node],
				}
			case 'down':
				return {
					kind: 'split',
					orientation: 'column',
					children: [node, fresh],
				}
			default:
				return {
					kind: 'split',
					orientation: 'row',
					children: [node, fresh],
				}
		}
	}
	return {
		...node,
		children: [
			insertSplit(
				node.children[0],
				targetSessionId,
				newSessionId,
				direction,
			),
			insertSplit(
				node.children[1],
				targetSessionId,
				newSessionId,
				direction,
			),
		],
	}
}

// Remove a leaf; the sibling subtree takes the parent's place. Removing the
// last leaf collapses the tree to null.
export const removeLeaf = (
	node: SplitNode,
	sessionId: string,
): SplitNode | null => {
	if (node.kind === 'leaf') {
		return node.sessionId === sessionId ? null : node
	}
	const first = removeLeaf(node.children[0], sessionId)
	const second = removeLeaf(node.children[1], sessionId)
	if (first && second) {
		return first === node.children[0] && second === node.children[1]
			? node
			: { ...node, children: [first, second] }
	}
	return first ?? second
}

type SplitAxis = SplitOrientation

const axisOf = (focus: SplitFocus): SplitAxis =>
	focus === 'left' || focus === 'right' ? 'row' : 'column'

// The child index a leaf must occupy for the move to cross this split: moving
// left (or up) requires coming from the second child, right/down from the first.
const nearSideIndex = (focus: SplitFocus): number =>
	focus === 'left' || focus === 'up' ? 1 : 0

// Entering a subtree after crossing an edge: land on the leaf adjacent to that
// edge (moving left → the subtree's rightmost pane), top/left-biased on the
// cross axis.
const edgeLeaf = (node: SplitNode, focus: SplitFocus): string => {
	if (node.kind === 'leaf') return node.sessionId
	const index =
		node.orientation === axisOf(focus) ? 1 - nearSideIndex(focus) : 0
	return edgeLeaf(index === 1 ? node.children[1] : node.children[0], focus)
}

type PathStep = {
	orientation: SplitOrientation
	index: number
	sibling: SplitNode
}

const pathTo = (
	node: SplitNode,
	sessionId: string,
	acc: PathStep[],
): PathStep[] | null => {
	if (node.kind === 'leaf') {
		return node.sessionId === sessionId ? acc : null
	}
	for (const index of [0, 1]) {
		const child = node.children[index]
		const sibling = node.children[1 - index]
		if (!child || !sibling) continue
		const found = pathTo(child, sessionId, [
			...acc,
			{ orientation: node.orientation, index, sibling },
		])
		if (found) return found
	}
	return null
}

// Navigation needs somewhere to go: a lone pane has no neighbor.
const MIN_LEAVES_FOR_NAVIGATION = 2

// The session goto_split lands on, or null when no pane lies that way (the
// performable contract: a null neighbor lets the key fall through to the PTY).
export const neighborLeaf = (
	tree: SplitNode,
	fromSessionId: string,
	focus: SplitFocus,
): string | null => {
	const order = leavesOf(tree)
	const at = order.indexOf(fromSessionId)
	if (at === -1 || order.length < MIN_LEAVES_FOR_NAVIGATION) return null

	if (focus === 'previous' || focus === 'next') {
		const step = focus === 'previous' ? -1 : 1
		return order[(at + step + order.length) % order.length] ?? null
	}

	const path = pathTo(tree, fromSessionId, [])
	if (!path) return null
	for (let depth = path.length - 1; depth >= 0; depth -= 1) {
		const step = path[depth]
		if (!step) continue
		if (
			step.orientation === axisOf(focus) &&
			step.index === nearSideIndex(focus)
		) {
			return edgeLeaf(step.sibling, focus)
		}
	}
	return null
}

// Drop a (closed) session from whatever tree holds it, moving keyboard focus
// to its previous neighbor first so the active pane never points at a corpse.
// A root view shrinking to its own bare leaf drops the tree entry entirely.
export const removeSessionFromSplits = (sessionId: string): void => {
	const store = getDefaultStore()
	const trees = store.get(splitTreesAtom)
	const rootId = findRootId(trees, sessionId)
	if (!rootId) return
	const tree = trees[rootId]
	if (!tree) return

	if (store.get(activeSessionIdAtom) === sessionId) {
		const fallback =
			neighborLeaf(tree, sessionId, 'previous') ??
			(rootId === sessionId ? null : rootId)
		store.set(activeSessionIdAtom, fallback)
	}

	const next = removeLeaf(tree, sessionId)
	const { [rootId]: _removed, ...rest } = trees
	if (next && !(next.kind === 'leaf' && next.sessionId === rootId)) {
		store.set(splitTreesAtom, { ...rest, [rootId]: next })
		return
	}
	store.set(splitTreesAtom, rest)
}

let lifecycleStarted = false

// A split pane whose child exits disappears from the layout, like Ghostty
// closing the surface. Idempotent, started once from main.tsx; its own
// listener (not the sessions bridge) keeps the module dependency one-way.
export const startSplitLifecycle = (): void => {
	if (lifecycleStarted) return
	lifecycleStarted = true
	listen<SessionEndPayload>(AGENT_END_EVENT, ({ payload }) => {
		removeSessionFromSplits(payload.session_id)
	}).catch((error: unknown) => {
		lifecycleStarted = false
		const { message, stack } = describeError(error)
		logger.error(`startSplitLifecycle: listen failed: ${message}`, {
			scope: 'split-layout',
			details: { stack },
		})
	})
}
