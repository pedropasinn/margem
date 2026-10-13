/**
 * Primeira execução de uma instalação local (J103):
 *
 *   GET  /api/estado-instalacao            banco, motor, `codex` (no PATH, versão, logado), cota e
 *                                          se a primeira execução foi concluída. `?renovar=1`
 *                                          ignora a memória de alguns segundos (o "Verificar de novo").
 *   POST /api/estado-instalacao/exemplo    semeia (ou reaproveita) o documento de exemplo já marcado
 *   POST /api/estado-instalacao/concluir   marca a primeira execução como concluída (idempotente)
 *
 * Nenhuma das três chama o Codex para ler nada: a verificação roda `codex --version`,
 * `codex exec --help` e `codex login status`, que não usam a cota nem a rede.
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { comMemoria, concluirPrimeiraExecucao, lerEstadoDaInstalacao, VERIFICADORES_PADRAO, type Verificadores } from '../primeira-execucao/estado.js';
import { semearExemplo } from '../primeira-execucao/exemplo.js';

/** Validade da memória das verificações do `codex` e do motor. */
export const VALIDADE_DA_VERIFICACAO_MS = 20_000;

export function registrarRotasDaPrimeiraExecucao(api: Hono, apoio: { banco: pg.Pool; verificadores?: Partial<Verificadores> }): void {
  const { banco } = apoio;
  const base = { ...VERIFICADORES_PADRAO, ...apoio.verificadores };
  const codex = comMemoria(base.codex, VALIDADE_DA_VERIFICACAO_MS);
  const motor = comMemoria(base.motor, VALIDADE_DA_VERIFICACAO_MS);

  api.get('/api/estado-instalacao', async (c) => {
    const renovar = c.req.query('renovar') === '1';
    const estado = await lerEstadoDaInstalacao(banco, {
      codex: () => codex(renovar), motor: () => motor(renovar), executor: base.executor,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(estado);
  });

  api.post('/api/estado-instalacao/exemplo', async (c) => {
    const exemplo = await semearExemplo(banco);
    return c.json(exemplo, exemplo.criado ? 201 : 200);
  });

  api.post('/api/estado-instalacao/concluir', async (c) => {
    const concluida_em = await concluirPrimeiraExecucao(banco);
    return c.json({ concluida: true, concluida_em });
  });
}
