import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm, ROTEIRO } from '../../testes/compreensao.js';
import { criarExecutorFalso, type Roteiro } from '../executor/fake.js';
import { executorAuditado } from '../executor/auditoria.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import * as repo from '../repos/compreensao.js';
import { exigirModo } from '../modos.js';
import { capitulosDaExecucao, estadoDoCapitulo, iniciarCompreensao, prepararCapitulo } from './pipeline.js';

const temporarios: string[] = [];
afterEach(async () => { for (const pasta of temporarios.splice(0)) await rm(pasta, { recursive: true, force: true }); });
test('economia @2 publica análise, síntese, revisão e plano com o protocolo escolhido', async () => comBanco('generos_economia', async banco => {
  const canonico = livro();
  const versao = await comTransacao(banco, async c => {
    const documento = await documentos.criar(c, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(c, documento.id, canonico);
  });
  const { config, auditoria, artefatos } = await configurar(banco, temporarios);
  // Só vocabulário da fixture muda; o executor continua determinístico e offline.
  const roteiro = JSON.parse(JSON.stringify(ROTEIRO).replaceAll('"papel":"tese"', '"papel":"resultado"').replaceAll('"papel":"justificativa"', '"papel":"identificacao"')) as Roteiro;
  const falso = criarExecutorFalso(roteiro);
  const prompts: string[] = [];
  config.executor = executorAuditado(async pedido => {
    const texto = pedido.prompt.includes('prompt.md') ? await readFile(join(pedido.diretorioEntrada, 'prompt.md'), 'utf8') : pedido.prompt;
    prompts.push(texto);
    return falso({ ...pedido, diretorioArtefatos: artefatos });
  }, { commit: () => 'teste-generos' });
  const execucao = await iniciarCompreensao(config, versao.id, exigirModo({ id: 'economica', revisao: 2 }));
  expect(execucao.prompts).toEqual({ analise: 'analisar-passagens@2', sintese: 'sintetizar-capitulo@2', revisao: 'revisar-capitulo@2', plano: 'planejar-leitura@3' });
  const [capitulo] = await comTransacao(banco, c => capitulosDaExecucao(c, execucao.id));
  if (!capitulo) throw new Error('Capítulo ausente.');
  await prepararCapitulo(config, execucao.id, capitulo);
  const slots = await mkdtemp(join(tmpdir(), 'margem-generos-')); temporarios.push(slots);
  for (let i = 0; i < 4; i++) await rodarUm(banco, config, auditoria, slots);
  expect((await comTransacao(banco, c => estadoDoCapitulo(c, execucao.id, capitulo))).estado).toBe('pronto');
  const revisoes = await comTransacao(banco, c => repo.revisoesDoCapitulo(c, execucao.id, capitulo));
  expect(revisoes).toHaveLength(3);
  expect(revisoes.every(r => r.modo.id === 'economica' && r.modo.revisao === 2)).toBe(true);
  expect(await comTransacao(banco, c => repo.planoDoCapitulo(c, execucao.id, capitulo))).not.toBeNull();
  expect(prompts).toHaveLength(4);
  for (const texto of prompts) expect(texto).toContain('Calibração não é estimação');
}));
