/**
 * V-A8: documento sem capítulo explícito vira capítulo único e se prepara (sem 409 `sem_capitulos`).
 * - Markdown que começa em `## Seção`: o motor numera os níveis pela pilha, então a primeira seção é de
 *   nível 1 (o contrato do canônico exige isso); a preparação funciona.
 * - Sessão importada do Horarium (o único canônico do serviço sem seções): ganha um capítulo com o título.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, expect, test } from 'vitest';
import { validarCanonico, type Id } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { configurar } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { raizDoRepositorio } from '../dados.js';
import { criarApi } from '../http/app.js';
import { canonicoDaSessao } from '../leitura/importar.js';
import * as documentos from '../repos/documentos.js';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';

const temporarios: string[] = [];
const dadosOriginais = process.env.MARGEM_DADOS;
afterEach(async () => {
  if (dadosOriginais === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = dadosOriginais;
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };

async function canonizar(banco: pg.Pool): Promise<void> {
  const vagas = await mkdtemp(join(tmpdir(), 'margem-cap-unico-vagas-'));
  temporarios.push(vagas);
  await new Worker({
    fila: new FilaPostgres(banco), manipuladores: { [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }) },
    diretorioSlots: vagas, slots: 1, intervaloMs: 5, maximoCiclos: 1,
  }).rodar();
}

test('Markdown que começa em "## Seção" é preparado sem 409', async () => comBanco('cap_unico_md', async (banco) => {
  const dados = await mkdtemp(join(tmpdir(), 'margem-cap-unico-dados-'));
  temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  const formulario = new FormData();
  formulario.set('titulo', 'Seções soltas');
  formulario.set('formato', 'md');
  formulario.set('arquivo', new File(['## Seção um\n\nTexto da seção, sem capítulo acima.\n\n## Seção dois\n\nOutro trecho.\n'], 'secoes.md', { type: 'text/markdown' }));
  const envio = await api.request('/api/documentos', { method: 'POST', headers: { 'X-Margem': '1' }, body: formulario });
  expect(envio.status).toBe(202);
  const { documento_id } = await envio.json() as { documento_id: Id };
  await canonizar(banco);
  expect((await api.request(`/api/documentos/${documento_id}/tipo-de-texto`, { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ tipo_id: 'outro' }) })).status).toBe(200);
  // Texto curto demais para o preparo automático ao importar: o clique cria a compreensão.
  const preparo = await api.request(`/api/documentos/${documento_id}/preparacao`, { method: 'POST', headers: ESCRITA });
  expect(preparo.status).toBe(201);
  const { situacao } = await preparo.json() as { situacao: { capitulos: { titulo: string; estado: string }[] } };
  expect(situacao.capitulos.map((capitulo) => [capitulo.titulo, capitulo.estado])).toEqual([['Seção um', 'preparando'], ['Seção dois', 'preparando']]);
}));

test('sessão importada do Horarium vira capítulo único, aberto pelo título, e se prepara', async () => comBanco('cap_unico_sessao', async (banco) => {
  const canonico = canonicoDaSessao({
    documento: { id: 'h1', titulo: 'Um apólogo', autor: 'Machado de Assis', rawText: 'Era uma vez uma agulha.\n\nQue disse a um novelo de linha.' },
  } as Parameters<typeof canonicoDaSessao>[0], { idioma: 'pt' });
  expect(validarCanonico(canonico)).toBe(true);
  expect(canonico.secoes).toMatchObject([{ nivel: 1, titulo: 'Um apólogo' }]);
  expect(canonico.blocos.map((bloco) => bloco.tipo)).toEqual(['capitulo', 'paragrafo', 'paragrafo']);
  const documento = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'horarium/um-apologo.json' });
    await documentos.criarVersao(cliente, criado.id, canonico);
    return criado;
  });
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, compreensao: () => config });
  expect((await api.request(`/api/documentos/${documento.id}/tipo-de-texto`, { method: 'PUT', headers: ESCRITA, body: JSON.stringify({ tipo_id: 'conto' }) })).status).toBe(200);
  const preparo = await api.request(`/api/documentos/${documento.id}/preparacao`, { method: 'POST', headers: ESCRITA });
  expect(preparo.status).toBe(201);
  expect(await preparo.json()).toMatchObject({ situacao: { compreensao: { modo: { id: 'ficcao_narrativa' } }, capitulos: [{ titulo: 'Um apólogo', estado: 'preparando' }] } });
}));
