import base from '@nextnode-solutions/standards/oxfmt'

export default {
	...base,
	ignorePatterns: [...(base.ignorePatterns ?? []), 'coverage/**'],
}
