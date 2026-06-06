import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				// Specify the entrypoint for SELF integration tests
				main: 'src/index.ts',
				// Disable isolated storage between tests to prevent macOS-specific SQLite lock file errors
				// during R2/Cache cleanups.
				isolatedStorage: false,
				miniflare: {
					compatibilityDate: '2025-03-10',
					r2Buckets: ['IMAGES_BUCKET'],
					bindings: {
						R2_PUBLIC_URL: 'https://mp-r2.084817.xyz',
						AI: 'MOCK_AI_BINDING',
					},
				},
			},
		},
	},
	plugins: [
		{
			name: 'html-loader',
			transform(code, id) {
				if (id.endsWith('.html')) {
					return {
						code: `export default ${JSON.stringify(code)};`,
						map: null,
					};
				}
			},
		},
	],
});
