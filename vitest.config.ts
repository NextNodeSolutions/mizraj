import baseConfig from '@nextnode-solutions/standards/vitest/frontend'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			exclude: ['node_modules/**', 'dist/**', '.infra/**', 'e2e/**'],
		},
	}),
)
