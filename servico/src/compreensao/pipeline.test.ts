import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { LoteDoModeloV1 } from '@margem/contratos';
import { validarModeloDoCapitulo } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { exigirModo } from '../modos.js';
import * as documentos from '../repos/documentos.js';
import * as marcasRepo from '../repos/marcas.js';
import * as repo from '../repos/compreensao.js';
import { relatorioDaMarca } from '../ferramentas/auditar.js';
import { resumoDoCapitulo } from './auditoria.js';
import {
  capitulosDaExecucao, estadoDoCapitulo, estadoVisivel, iniciarCompreensao, lerChave, prepararCapitulo,
} from './pipeline.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

test('um capítulo percorre análise, síntese, revisão, projeção e plano; o seguinte fica na fila com prioridade menor', async () => comBanco('compreensao_ponta', async (banco) => {
  const canonico = livro();
  const versao = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versao.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const [cap1, cap2] = await comTransacao(banco, (cliente) => capitulosDaExecucao(cliente, execucao.id));
  if (!cap1 || !cap2) throw new Error('dois capítulos esperados');
  expect(await comTransacao(banco, (cliente) => estadoDoCapitulo(cliente, execucao.id, cap1))).toMatchObject({ estado: 'nao_preparado', visivel: 'nao_preparado' });

  const pedido = await prepararCapitulo(config, execucao.id, cap1, { prefetch: true });
  expect(pedido.seguinte).toBe(cap2);
  const prioridades = (await banco.query<{ dedup_key: string; prioridade: number }>('SELECT dedup_key, prioridade FROM job ORDER BY prioridade DESC')).rows;
  expect(prioridades.map((linha) => linha.prioridade)).toEqual([100, 50]);
  expect(await comTransacao(banco, (cliente) => estadoDoCapitulo(cliente, execucao.id, cap1))).toMatchObject({ estado: 'na_fila', visivel: 'preparando' });

  const slots = await mkdtemp(join(tmpdir(), 'margem-compreensao-slots-'));
  temporarios.push(slots);
  const estados: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await rodarUm(banco, config, auditoria, slots);
    estados.push((await comTransacao(banco, (cliente) => estadoDoCapitulo(cliente, execucao.id, cap1))).estado);
  }
  expect(estados).toEqual(['sintetizando', 'revisando', 'projetando', 'pronto']);

  const revisoes = await comTransacao(banco, (cliente) => repo.revisoesDoCapitulo(cliente, execucao.id, cap1));
  expect(revisoes.map((item) => [item.revisao, item.estagio])).toEqual([[0, 'analise_local'], [1, 'sintese'], [2, 'revisao']]);
  for (const revisao of revisoes) expect(validarModeloDoCapitulo(revisao)).toBe(true);
  const [r0, r1, r2] = revisoes;
  if (!r0 || !r1 || !r2) throw new Error('três revisões esperadas');
  // Análise local: o elemento com citação inventada e a dificuldade que fala do leitor caem; o qualificador de fora sai.
  expect(r0.elementos).toHaveLength(3);
  expect(r0.elementos[0]?.qualificadores).toEqual(['inicialmente']);
  expect(r0.relacoes).toHaveLength(1);
  expect(r0.dificuldades.map((item) => item.tipo)).toEqual(['salto_argumentativo']);
  // Síntese: unidades particionam o capítulo; a relação retrospectiva entra; o exemplo desce; o alias inventado não.
  expect(r1.unidades.map((item) => [item.bloco_inicio, item.bloco_fim])).toEqual([[canonico.blocos[0]?.id, canonico.blocos[2]?.id], [canonico.blocos[3]?.id, canonico.blocos[4]?.id]]);
  expect(r1.relacoes.find((item) => item.retrospectiva)?.tipo).toBe('pressupoe');
  const hipotese = r0.elementos[0]?.id;
  expect(r1.elementos.find((item) => item.nucleo === 'exemplo')?.centralidade).toBe(3);
  // Revisão global: a hipótese provisória vira estrutural.
  expect(r2.elementos.find((item) => item.id === hipotese)?.centralidade).toBe(1);
  const lotes = await comTransacao(banco, (cliente) => repo.lotesDoCapitulo(cliente, execucao.id, cap1));
  expect(lotes.map((lote: LoteDoModeloV1) => [lote.estagio, lote.operacoes.map((op) => op.op)])).toEqual([
    ['sintese', ['definir_unidades', 'definir_movimento', 'criar_relacao', 'rebaixar']],
    ['revisao', ['promover', 'acrescentar_nota']],
  ]);
  expect(lotes[1]?.operacoes[0]).toMatchObject({ op: 'promover', antes: { centralidade: 3 }, depois: { centralidade: 1 } });
  expect(lotes[1]?.operacoes[0]?.evidencia[0]?.citacao).toBe('somente com preços rígidos o choque reduz o produto');

  // Projeção: três marcas na camada da execução, cada uma ligada ao seu elemento. O nível 1 do capítulo
  // curto só comporta uma marca pelo alvo do modo (J76): fica a hipótese, de que a tese depende; a tese desce a 2.
  const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarV2PorVersao(cliente, versao.id, { camada_id: execucao.id }));
  expect(marcas.map((marca) => [marca.funcao, marca.saliencia, marca.origem]).sort()).toEqual([
    ['conceito', 1, 'projecao'], ['justificativa', 3, 'projecao'], ['tese', 2, 'projecao'],
  ]);
  const hipoteseMarcada = marcas.find((marca) => marca.funcao === 'conceito');
  expect(hipoteseMarcada?.comentario?.tipo).toBe('INVESTIGAR');
  expect(hipoteseMarcada?.subfaixas).toHaveLength(1);
  expect(marcas.find((marca) => marca.funcao === 'tese')?.comentario).toMatchObject({ tipo: 'LEITURA' });
  // Todo grifo tem nota: sem nota analítica, a justificativa periférica leva o enunciado do autor.
  expect(marcas.find((marca) => marca.funcao === 'justificativa')?.comentario).toMatchObject({ tipo: 'AUTOR', texto: 'O cardápio impresso ilustra a rigidez.' });
  expect((await comTransacao(banco, (cliente) => repo.marcasDoModelo(cliente, r2.id))).length).toBe(3);

  // Plano: dois passos que cobrem o capítulo; o alias de foco inventado cai.
  const plano = await comTransacao(banco, (cliente) => repo.planoDoCapitulo(cliente, execucao.id, cap1));
  expect(plano?.passos.map((passo) => [passo.bloco_inicio, passo.bloco_fim])).toEqual([[canonico.blocos[0]?.id, canonico.blocos[2]?.id], [canonico.blocos[3]?.id, canonico.blocos[4]?.id]]);
  expect(plano?.passos[1]?.foco).toHaveLength(1);
  expect(plano?.passos[0]?.relacoes).toEqual([r1.relacoes.find((item) => item.retrospectiva)?.id]);
  expect(plano?.apoios).toHaveLength(1);

  // O auditor conta a história da hipótese: nasceu periférica, a revisão global a promoveu, com o motivo.
  const historia = await relatorioDaMarca(banco, hipoteseMarcada?.id ?? '', { raiz: auditoria, resumo: true });
  expect(historia).toContain('ANÁLISE LOCAL (r0)');
  expect(historia).toContain('pressupoe “Admitamos inicialmente que os preços são rígidos” (retrospectiva)');
  expect(historia).toContain('promover: centralidade 3 → 1');
  expect(historia).toContain('motivo: L03 depende dela; o autor a apresenta como provisória.');
  expect(historia).toContain('┌─ PROMPT');
  const resumo = await resumoDoCapitulo(banco, execucao.id, cap1);
  expect(resumo).toContain('pronto (pronto)');
  expect(resumo).toContain('revisao · promover ×1, acrescentar_nota ×1');

  // O capítulo seguinte continua na fila, e a auditoria gravou prompt, aliases e diagnósticos de cada chamada.
  expect((await comTransacao(banco, (cliente) => estadoDoCapitulo(cliente, execucao.id, cap2))).estado).toBe('na_fila');
  const jobs = await readdir(join(auditoria, 'jobs'));
  expect(jobs).toHaveLength(4);
  for (const job of jobs) {
    const arquivos = await readdir(join(auditoria, 'jobs', job, 'tentativa-1'));
    expect(arquivos).toEqual(expect.arrayContaining(['prompt.txt', 'aliases.json', 'resposta.bruta.json', 'resposta.validada.json', 'diagnosticos.json']));
    const prompt = await readFile(join(auditoria, 'jobs', job, 'tentativa-1', 'prompt.txt'), 'utf8');
    expect(prompt).not.toMatch(/[0-7][0-9A-HJKMNP-TV-Z]{25}/u);
  }
}));

test('chaves dos jobs e estados visíveis', () => {
  expect(lerChave('revisar:A:B:1:3')).toEqual({ execucao_id: 'A', secao_id: 'B', janela: 1, total: 3 });
  expect(lerChave('planejar:A:B:M:H')).toEqual({ execucao_id: 'A', secao_id: 'B', modelo_id: 'M', perfil_hash: 'H' });
  expect(() => lerChave('revisar:A:B:3:3')).toThrow();
  expect(estadoVisivel('revisando')).toBe('preparando');
  expect(estadoVisivel('parcial')).toBe('pronto');
});
