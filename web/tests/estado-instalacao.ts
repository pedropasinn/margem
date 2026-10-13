/**
 * Estado da instalação para as capturas (J103): `GET /api/estado-instalacao` de uma instalação pronta
 * e com a primeira execução já concluída, para as telas antigas não ganharem o diálogo nem avisos.
 */
import type { EstadoDaInstalacao } from '../src/primeira-execucao/estado.ts';

export const INSTALACAO_PRONTA: EstadoDaInstalacao = {
  versao: 1, banco: { ok: true }, motor: { ok: true },
  codex: { encontrado: true, versao: 'codex-cli 0.160.0', compativel: true, logado: true, conta: 'chatgpt', executor: 'codex' },
  cota: { esgotada: false, volta_em: null },
  primeira_execucao: { concluida: true, concluida_em: '2026-10-12T12:00:00.000Z', exemplo_documento_id: null },
  pronto: true,
};
