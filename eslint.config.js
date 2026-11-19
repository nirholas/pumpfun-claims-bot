// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/', 'node_modules/', 'leaderboard-bot/', 'packages/', 'web/', 'docs/'] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
        },
    },
    {
        // Test doubles are often async without awaiting, and vitest asserts on
        // methods detached from their objects (expect(obj.method).toHaveBeenCalled()).
        files: ['src/__tests__/**/*.ts'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },
    {
        files: ['*.config.js', '*.config.ts'],
        ...tseslint.configs.disableTypeChecked,
    },
);
