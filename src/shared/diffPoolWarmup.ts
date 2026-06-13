import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'

// The worker pool attaches grammars at boot but never tokenizes until a real
// file opens, so the JS-regex engine (shiki-js) compiles its patterns and V8
// JITs the tokenizer lazily — on the FIRST few real opens, per worker (each is
// its own isolate). That is the "first 4-5 files are slow, then instant" curve
// in review. We pay that cost up front instead: at boot we prime each primary
// language with a synthetic diff so both workers compile + JIT before the user
// ever opens the cockpit. The extensions mirror the grammars preloaded in
// diffWorkerPool.tsx; keep the two lists in sync.
const WARM_SNIPPETS = {
	ts: [
		'// warm-up: exercise the typescript grammar',
		'export const answer: number = 42',
		'type Pair<T> = { left: T; right: T }',
		'function greet(name: string): string { return `hello ${name}` }',
		'const data = { items: [1, 2, 3], lookup: new Map<string, number>() }',
		'if (answer > 0) { console.log(greet("world"), data) }',
	],
	tsx: [
		'import { useState } from "react"',
		'export const Counter = (): JSX.Element => {',
		'\tconst [count, setCount] = useState(0)',
		'\treturn <button className="btn" onClick={() => setCount(count + 1)}>{count}</button>',
		'}',
	],
	js: [
		'const doubled = [1, 2, 3].map(value => value * 2)',
		'function sum(left, right) { return left + right }',
		'const total = doubled.reduce(sum, 0)',
		'console.log(`total: ${total}`)',
	],
	jsx: [
		'export function Item({ label }) {',
		'\treturn <li className="item" title={label}>{label}</li>',
		'}',
	],
	json: [
		'{',
		'\t"name": "warm",',
		'\t"version": 1,',
		'\t"tags": ["a", "b"],',
		'\t"nested": { "enabled": true, "ratio": 0.5 }',
		'}',
	],
	css: [
		'.panel { display: flex; gap: 8px; color: #ffffff; }',
		'.panel:hover { background: rgba(0, 0, 0, 0.5); }',
		'@media (min-width: 720px) { .panel { padding: 12px 16px; } }',
	],
	rs: [
		'fn main() {',
		'\tlet values: Vec<i32> = vec![1, 2, 3];',
		'\tlet total: i32 = values.iter().sum();',
		'\tprintln!("total = {}", total);',
		'}',
	],
	md: [
		'# Warm-up',
		'Some **bold** text and `inline code` plus a [link](https://example.com).',
		'- first item',
		'- second item',
	],
	toml: [
		'[package]',
		'name = "warm"',
		'version = "0.1.0"',
		'features = ["a", "b"]',
	],
} satisfies Record<string, ReadonlyArray<string>>

// A throwaway unified diff that adds `lines` to a new file named by extension,
// so parsePatchFiles detects the language and stamps a cacheKey (priming needs
// one). The `__warm__` name can never collide with a real reviewed file.
const buildWarmPatch = (
	extension: string,
	lines: ReadonlyArray<string>,
): string => {
	const name = `__warm__.${extension}`
	const header = `diff --git a/${name} b/${name}\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n`
	const body = lines.map(line => `+${line}`).join('\n')
	return `${header}${body}\n`
}

// Synthetic diffs to warm the pool, `poolSize` distinct-content variants per
// language laid out adjacently. With both workers idle at boot, the drain
// assigns a language's variants to different workers, so every primary grammar
// gets compiled + JITed on EVERY worker — not just whichever one drew it first.
export const buildWarmDiffs = (
	poolSize: number,
): ReadonlyArray<FileDiffMetadata> =>
	Object.entries(WARM_SNIPPETS).flatMap(([extension, lines]) =>
		Array.from({ length: poolSize }, (_unused, variant) =>
			parsePatchFiles(
				buildWarmPatch(extension, lines),
				`warm-${extension}-v${variant}`,
			).flatMap(parsed => parsed.files),
		).flat(),
	)

// The one method we need from the worker pool: priming submits a real highlight
// task (forcing tokenization) and caches it under the diff's synthetic cacheKey.
type DiffPoolPrimer = {
	primeDiffHighlightCache: (diff: FileDiffMetadata) => void
}

export const warmDiffPool = (
	primer: DiffPoolPrimer,
	poolSize: number,
): void => {
	for (const diff of buildWarmDiffs(poolSize)) {
		primer.primeDiffHighlightCache(diff)
	}
}
