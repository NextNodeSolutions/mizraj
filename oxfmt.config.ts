import base from '@nextnode-solutions/standards/oxfmt'

export default {
	...base,
	// release-please owns CHANGELOG.md and the manifest: it rewrites them
	// unformatted on every release, so letting oxfmt touch them produces the
	// same flip-flop the base config avoids for package.json. The hand-authored
	// release-please-config.json is never rewritten by the bot, so it stays
	// formatted normally.
	ignorePatterns: [
		...(base.ignorePatterns ?? []),
		'coverage/**',
		'CHANGELOG.md',
		'.release-please-manifest.json',
	],
}
