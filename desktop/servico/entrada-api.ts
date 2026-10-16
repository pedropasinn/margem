/**
 * Entrada da API dentro do app de computador. O bundle (esbuild) não passa pelo teste de `argv[1]` do
 * `servico/src/api.ts`, então quem chama `principal()` é esta casca.
 */
import { principal } from '../../servico/src/api.js';
import { encerrarPorMensagem } from './encerramento.js';

// L-07: pedida a parada, a API sai em 10 s mesmo com um SSE do navegador aberto.
encerrarPorMensagem({ prazoMs: 10_000 });
principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : 'falha desconhecida na API');
  process.exitCode = 1;
});
