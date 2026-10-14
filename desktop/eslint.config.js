import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'saida/**', 'recursos/**'] },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Dois projetos: o do Node (processo principal, serviço, testes) e o do renderer (DOM).
        project: ['./tsconfig.json', './tsconfig.janela.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
