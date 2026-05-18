import base from '@nextnode-solutions/standards/oxlint'

export default {
	...base,
	rules: {
		...base.rules,
		'react/react-in-jsx-scope': 'off',
	},
}
