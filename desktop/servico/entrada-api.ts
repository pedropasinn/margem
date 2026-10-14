/**
 * Entrada da API dentro do app de computador. O bundle (esbuild) não passa pelo teste de `argv[1]` do
 * `servico/src/api.ts`, então quem chama `principal()` é esta casca.
 */
import { principal } from '../../servico/src/api.js';
import { encerrarPorMensagem } from './encerramento.js';

encerrarPorMensagem();
principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : 'falha desconhecida na API');
  process.exitCode = 1;
});
