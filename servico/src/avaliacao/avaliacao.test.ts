import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { MarcaV2 } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { capitulosDaExecucao, iniciarCompreensao, prepararCapitulo } from '../compreensao/pipeline.js';
import { comTransacao } from '../db/transacao.js';
import { comecarComparacaoCega, medirCamadas, registrarEscolha, revelar } from '../ferramentas/avaliar.js';
import { exigirModo } from '../modos.js';
import * as camadasRepo from '../repos/camadas.js';
import * as documentos from '../repos/documentos.js';
import { casam, estabilidade } from './metricas.js';
import { lerReferencia, ReferenciaInvalida, resolverReferencia } from './referencia.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

function referencia(secao: string): string {
  return [
    '# Referência · Preços e produto, cap. 1 · argumentativa',
    `secao: ${secao}`,
    '',
    '## Essenciais',
    '- A · hipotese · “Admitamos inicialmente que os preços são rígidos”',
    '- K · tese · “somente com preços rígidos o choque reduz o produto”',
    '',
    '## Relações',
    '- K -> A · pressupoe',
    '',
    '## Retrospectivas',
    '- A',
    '',
    '## Dificuldades textuais',
    '- H · salto_argumentativo · “o choque reduz o produto”',
    '',
    '## Não deveria marcar',
    '- C · “o cardápio impresso não muda todo dia”',
  ].join('\n');
}

test('o formato da referência lê seções, relações e desambiguação, e aponta cada erro com a linha', () => {
  const lida = lerReferencia(`${referencia('S')}\n- X · “A tese” · antes: “Uma ” · depois: “ vale”`);
  expect(lida.secao_id).toBe('S');
  expect(lida.essenciais.map((item) => [item.rotulo, item.tipo])).toEqual([['A', 'hipotese'], ['K', 'tese']]);
  expect(lida.relacoes).toEqual([{ origem: 'K', destino: 'A', tipo: 'pressupoe', linha: 9 }]);
  expect(lida.nao_marcar.at(-1)).toMatchObject({ rotulo: 'X', prefixo: 'Uma ', sufixo: ' vale' });
  expect(() => lerReferencia('## Relações\n- A -> Z')).toThrow(ReferenciaInvalida);
  expect(() => lerReferencia('## Essenciais\n- sem citação')).toThrow('linha 2');
  expect(() => lerReferencia('## Outra coisa\n- A')).toThrow('seção desconhecida');
  const blocos = [{ id: 'b1', texto: 'a mesma frase e a mesma frase' }];
  expect(() => resolverReferencia(lerReferencia('## Essenciais\n- A · t · “a mesma frase”'), 'v', blocos)).toThrow('mais de uma vez');
  expect(() => resolverReferencia(lerReferencia('## Essenciais\n- A · t · “ausente”'), 'v', blocos)).toThrow('não aparece');
  expect(resolverReferencia(lerReferencia('## Essenciais\n- A · t · “a mesma frase” · depois: “ e a”'), 'v', blocos).essenciais[0]?.ancora.inicio_utf16).toBe(0);
});

test('casamento por sobreposição e estabilidade entre execuções', () => {
  const ancora = (inicio: number, fim: number) => ({ versao_id: 'v', bloco_id: 'b', inicio_utf16: inicio, fim_utf16: fim, citacao: 'x'.repeat(fim - inicio), prefixo: '', sufixo: '' });
  expect(casam(ancora(0, 10), ancora(4, 30))).toBe(true);
  expect(casam(ancora(0, 10), ancora(6, 30))).toBe(false);
  const marca = (inicio: number, fim: number): MarcaV2 => ({ ancora: ancora(inicio, fim), saliencia: 1, visivel: true } as MarcaV2);
  expect(estabilidade([[marca(0, 10)], [marca(0, 10)], [marca(0, 10)]])).toMatchObject({ media: 1, minimo: 1 });
  expect(estabilidade([[marca(0, 10)], [marca(20, 30)]]).media).toBe(0);
  expect(estabilidade([[marca(0, 10)]]).media).toBeNull();
});

test('medir a compreensão contra a referência; comparação cega troca e devolve os nomes', async () => comBanco('avaliacao_ponta', async (banco) => {
  const canonico = livro();
  const versao = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versao.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const [cap1] = await comTransacao(banco, (cliente) => capitulosDaExecucao(cliente, execucao.id));
  if (!cap1) throw new Error('capítulo esperado');
  await prepararCapitulo(config, execucao.id, cap1, { prefetch: false });
  const slots = await mkdtemp(join(tmpdir(), 'margem-avaliacao-slots-'));
  temporarios.push(slots);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, slots);

  const { texto, metricas } = await medirCamadas(banco, referencia(cap1), [execucao.id]);
  const [medida] = metricas;
  expect(medida?.cobertura_essenciais_marcas.valor).toBe(1);
  expect(medida?.cobertura_essenciais_modelo?.valor).toBe(1);
  expect(medida?.falsos_positivos.map((item) => item.rotulo)).toEqual(['C']);
  expect(medida?.relacoes?.encontradas.valor).toBe(1);
  expect(medida?.relacoes?.mesmo_tipo.valor).toBe(1);
  expect(medida?.retrospectivas_capturadas?.valor).toBe(1);
  expect(medida?.dificuldades_encontradas?.valor).toBe(1);
  expect(medida?.mudancas_da_revisao).toEqual({ uteis: ['promover A'], prejudiciais: [] });
  expect(medida?.precisao_vereditos.valor).toBeNull();
  expect(texto).toContain('Retrospectivas capturadas (r0 periférica → final estrutural): 100% (1/1)');
  expect(texto).toContain('Custo: 4 chamadas');

  const outra = await comTransacao(banco, (cliente) => camadasRepo.criarLoteDeImportacao(cliente, versao.id, { id: 'argumentativa', revisao: 1 }));
  const raiz = await mkdtemp(join(tmpdir(), 'margem-avaliacao-cega-'));
  temporarios.push(raiz);
  const sorteio = await comecarComparacaoCega(banco, [execucao.id, outra.id], raiz, () => 0);
  expect(sorteio.camadas).toEqual({ 'Leitura 1': outra.id, 'Leitura 2': execucao.id });
  const rotulos = await comTransacao(banco, (cliente) => camadasRepo.listar(cliente, versao.id));
  expect(rotulos.map((item) => item.rotulo).sort()).toEqual(['Leitura 1', 'Leitura 2']);
  await registrarEscolha(raiz, sorteio.id, 'Leitura 2', 'Mais fiel ao argumento.');
  await expect(registrarEscolha(raiz, sorteio.id, 'Leitura 9')).rejects.toThrow('Use um destes rótulos');
  expect(await readdir(raiz)).toEqual([`cega-${sorteio.id}.json`]);
  const revelado = await revelar(banco, raiz, sorteio.id);
  expect(revelado).toContain(`Leitura 2 = ${execucao.id}  ← a escolhida`);
  expect(revelado).toContain('Comentário: Mais fiel ao argumento.');
  expect((await comTransacao(banco, (cliente) => camadasRepo.listar(cliente, versao.id))).every((item) => item.rotulo === null)).toBe(true);
  expect(JSON.parse(await readFile(join(raiz, `cega-${sorteio.id}.json`), 'utf8'))).toMatchObject({ escolha: { rotulo: 'Leitura 2' } });
  await expect(comecarComparacaoCega(banco, [execucao.id], raiz)).rejects.toThrow('duas ou mais');
}));
