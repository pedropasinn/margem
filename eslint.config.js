import tseslint from 'typescript-eslint';

export default tseslint.config(
  // A extensão, o plugin do Obsidian e o app de computador (desktop/) são pacotes à parte (fora dos workspaces, com TypeScript e
  // dependências próprias): sem o `npm install` de cada um, os tipos deles não resolvem e o lint da
  // raiz fica vermelho com centenas de `no-unsafe-*` falsos. Cada um tem o seu `typecheck` e `test`.
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.venv/**', 'extensao/**', 'integracoes/obsidian/**', 'desktop/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.workspace.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
