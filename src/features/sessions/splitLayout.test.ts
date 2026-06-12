import { describe, expect, it } from 'vitest'

import type { SplitNode } from './splitLayout'
import {
	findRootId,
	insertSplit,
	leaf,
	leavesOf,
	neighborLeaf,
	removeLeaf,
} from './splitLayout'

describe('insertSplit', () => {
	it('replaces the target leaf with a pair, new pane on the named side', () => {
		expect(insertSplit(leaf('a'), 'a', 'b', 'right')).toEqual({
			kind: 'split',
			orientation: 'row',
			children: [leaf('a'), leaf('b')],
		})
		expect(insertSplit(leaf('a'), 'a', 'b', 'down')).toEqual({
			kind: 'split',
			orientation: 'column',
			children: [leaf('a'), leaf('b')],
		})
		expect(insertSplit(leaf('a'), 'a', 'b', 'left')).toEqual({
			kind: 'split',
			orientation: 'row',
			children: [leaf('b'), leaf('a')],
		})
		expect(insertSplit(leaf('a'), 'a', 'b', 'up')).toEqual({
			kind: 'split',
			orientation: 'column',
			children: [leaf('b'), leaf('a')],
		})
	})

	it('splits a nested target without disturbing its siblings', () => {
		const tree = insertSplit(leaf('a'), 'a', 'b', 'right')
		const grown = insertSplit(tree, 'b', 'c', 'down')

		expect(leavesOf(grown)).toEqual(['a', 'b', 'c'])
		expect(grown).toMatchObject({
			orientation: 'row',
			children: [
				{ kind: 'leaf', sessionId: 'a' },
				{ orientation: 'column' },
			],
		})
	})
})

describe('removeLeaf', () => {
	it('collapses the sibling into the parent slot', () => {
		const tree = insertSplit(leaf('a'), 'a', 'b', 'right')

		expect(removeLeaf(tree, 'b')).toEqual(leaf('a'))
	})

	it('returns null when the last leaf goes', () => {
		expect(removeLeaf(leaf('a'), 'a')).toBeNull()
	})

	it('leaves a tree without the session untouched (same reference)', () => {
		const tree = insertSplit(leaf('a'), 'a', 'b', 'right')

		expect(removeLeaf(tree, 'zz')).toBe(tree)
	})
})

describe('neighborLeaf', () => {
	// [a | [b / c]] : a left of a column holding b above c.
	const tree = insertSplit(
		insertSplit(leaf('a'), 'a', 'b', 'right'),
		'b',
		'c',
		'down',
	)

	it('cycles previous/next in pane order', () => {
		expect(neighborLeaf(tree, 'a', 'next')).toBe('b')
		expect(neighborLeaf(tree, 'c', 'next')).toBe('a')
		expect(neighborLeaf(tree, 'a', 'previous')).toBe('c')
	})

	it('moves directionally across the splits', () => {
		expect(neighborLeaf(tree, 'a', 'right')).toBe('b')
		expect(neighborLeaf(tree, 'b', 'left')).toBe('a')
		expect(neighborLeaf(tree, 'c', 'left')).toBe('a')
		expect(neighborLeaf(tree, 'b', 'down')).toBe('c')
		expect(neighborLeaf(tree, 'c', 'up')).toBe('b')
	})

	it('returns null at the edges so performable bindings fall through', () => {
		expect(neighborLeaf(tree, 'a', 'left')).toBeNull()
		expect(neighborLeaf(tree, 'a', 'up')).toBeNull()
		expect(neighborLeaf(tree, 'b', 'up')).toBeNull()
		expect(neighborLeaf(tree, 'c', 'down')).toBeNull()
		expect(neighborLeaf(leaf('a'), 'a', 'next')).toBeNull()
	})
})

describe('findRootId', () => {
	it('finds the tree containing a nested session', () => {
		const trees: Record<string, SplitNode> = {
			root: insertSplit(leaf('root'), 'root', 'shell', 'right'),
		}

		expect(findRootId(trees, 'shell')).toBe('root')
		expect(findRootId(trees, 'root')).toBe('root')
		expect(findRootId(trees, 'orphan')).toBeNull()
	})
})
