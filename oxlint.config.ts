import standardsConfig from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standardsConfig],
	rules: {
		'react/react-in-jsx-scope': 'off',
		// Stylesheets are loaded as side-effect imports (the Vite/React entry
		// pattern); they have nothing to assign.
		'import/no-unassigned-import': ['warn', { allow: ['**/*.css'] }],
	},
	overrides: [
		{
			// e2e specs legitimately step through the UI sequentially (await in
			// loop), reach framework/browser globals with underscore names
			// (__TAURI_INTERNALS__, perf-entry fields) and define page-injected
			// stubs in place — relax the stylistic rules that fight those here.
			files: ['e2e/**'],
			rules: {
				'no-await-in-loop': 'off',
				'no-underscore-dangle': 'off',
				'consistent-function-scoping': 'off',
			},
		},
	],
})
