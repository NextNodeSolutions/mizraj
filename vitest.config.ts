import { fileURLToPath } from 'node:url'

import baseConfig from '@nextnode-solutions/standards/vitest/frontend'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
			},
		},
		test: {
			exclude: ['node_modules/**', 'dist/**', '.infra/**', 'e2e/**'],
		},
	}),
)
