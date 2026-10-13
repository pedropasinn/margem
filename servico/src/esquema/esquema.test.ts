/**
 * Esquema do capítulo na API e no worker: Postgres de teste, compreensão real com o executor
 * falso do J29 (modelo r2) e o job `gerar_esquema` com outro executor falso. Nenhum Codex.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { validarEsquemaDoCapitulo, type EsquemaDoCapituloV1, type ModeloDoCapituloV1 } from '@margem/contratos';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso, type PassoRoteiro } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import { exigirModo } from '../modos.js';
import * as documentos from '../repos/documentos.js';
import * as repo from '../repos/compreensao.js';
import { iniciarCompreensao, prepararCapitulo } from '../compreensao/pipeline.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { caminhoDoEsquema } from './arquivos.js';
import { erroDoEsquema, manipuladoresDoEsquema, montarEsquema, type SaidaDoEsquema } from './manipuladores.js';
import { montarPromptDoEsquema, serializarModelo } from './prompts.js';

const temporarios: string[] = [];
let dados = '';
beforeEach(async () => { dados = await mkdtemp(join(tmpdir(), 'margem-esquema-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };

interface Situacao { estado: string; motivo?: string; pedido_id: string | null; esquema: EsquemaDoCapituloV1 | null }

async function prepararCompreensao(banco: pg.Pool) {
  const canonico = livro();
  const versao = await comTransacao(banco, async (c) => {
    const documento = await documentos.criar(c, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(c, documento.id, canonico);
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versao.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const secao = canonico.secoes[0]!;
  await prepararCapitulo(config, execucao.id, secao.id);
  const slots = await mkdtemp(join(tmpdir(), 'margem-esquema-slots-')); temporarios.push(slots);
  for (let i = 0; i < 3; i++) await rodarUm(banco, config, auditoria, slots);
  const modelo = await comTransacao(banco, (c) => repo.revisaoDoCapitulo(c, execucao.id, secao.id));
  if (!modelo) throw new Error('Pipeline não publicou o modelo.');
  return { canonico, versao, execucao, secao, modelo };
}

/** Saída do modelo que cita os três elementos do capítulo de teste por apelido e uma citação literal. */
function saidaBoa(modelo: ModeloDoCapituloV1, blocos: { id: string }[]): SaidaDoEsquema {
  const { apelidos } = serializarModelo(modelo, blocos);
  const [e1] = [...apelidos.elementos.keys()];
  return {
    titulo: 'Da hipótese à consequência',
    grupos: [{ id: 'G1', titulo: 'A hipótese', resumo: 'Fixa a rigidez.' }, { id: 'G2', titulo: 'A consequência', resumo: 'Tira a conclusão.' }, { id: 'G3', titulo: 'Sobra', resumo: 'Vazio.' }],
    nos: [
      { id: 'N1', rotulo: 'Preços rígidos', tipo: 'tese', grupo: 'G1', detalhe: 'A hipótese de partida.', elemento: e1 ?? null, citacao: null },
      { id: 'N2', rotulo: 'Cardápio impresso', tipo: 'exemplo', grupo: 'G1', detalhe: 'O exemplo da rigidez.', elemento: null,
        citacao: { bloco_id: blocos[2]!.id, texto: 'o cardápio impresso não muda todo dia' } },
      { id: 'N3', rotulo: 'Choque reduz o produto', tipo: 'conclusao', grupo: 'G2', detalhe: 'A consequência.', elemento: null,
        citacao: { bloco_id: blocos[4]!.id, texto: 'frase que não está lá' } },
      { id: 'N4', rotulo: 'Síntese', tipo: 'mecanismo', grupo: 'G2', detalhe: 'Síntese sem trecho.', elemento: 'E99', citacao: null },
    ],
    ligacoes: [
      { de: 'N2', para: 'N1', rotulo: 'exemplifica', forca: 'fraca' },
      { de: 'N1', para: 'N3', rotulo: 'leva a', forca: 'forte' },
      { de: 'N1', para: 'N3', rotulo: 'de novo', forca: 'forte' },
      { de: 'N3', para: 'N9', rotulo: 'some', forca: 'forte' },
    ],
  };
}

function montar(banco: pg.Pool, passos: PassoRoteiro[]) {
  const pedidos: PedidoExecucao[] = [];
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const falso = criarExecutorFalso({ versao: 1, passos });
  const artefatos = join(dados, 'artefatos');
  const executor = (pedido: PedidoExecucao) => { pedidos.push(pedido); return falso({ ...pedido, diretorioArtefatos: artefatos }); };
  const rodar = async () => {
    const slots = await mkdtemp(join(tmpdir(), 'margem-esquema-slots-'));
    temporarios.push(slots);
    await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDoEsquema({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos }),
      slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
  };
  return { api, pedidos, rodar };
}

async function situacao(api: Hono, caminho: string): Promise<Situacao> {
  const resposta = await api.request(caminho);
  expect(resposta.status).toBe(200);
  const corpo = await resposta.json() as Situacao;
  if (corpo.esquema) expect(validarEsquemaDoCapitulo(corpo.esquema), JSON.stringify(validarEsquemaDoCapitulo.errors)).toBe(true);
  return corpo;
}

test('gerar: pedido → Codex (falso) → esquema guardado na pasta da versão, com âncoras e diagnósticos; gerar de novo', async () => comBanco('esquema_gerar', async (banco) => {
  const { canonico, versao, execucao, secao, modelo } = await prepararCompreensao(banco);
  const blocos = canonico.blocos;
  const saida = saidaBoa(modelo, blocos);
  const { api, pedidos, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: saida },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: { ...saida, titulo: 'Segunda versão' } },
  ]);
  const caminho = `/api/compreensoes/${execucao.id}/capitulos/${secao.id}/esquema`;
  expect(await situacao(api, caminho)).toMatchObject({ estado: 'nenhum', esquema: null, pedido_id: null });

  const pedido = await api.request(caminho, { method: 'POST', headers: ESCRITA });
  expect(pedido.status).toBe(202);
  const pendente = await pedido.json() as Situacao;
  expect(pendente).toMatchObject({ estado: 'pendente', esquema: null });
  // Um segundo pedido com o primeiro em curso é recusado.
  expect((await api.request(caminho, { method: 'POST', headers: ESCRITA })).status).toBe(409);

  await rodar();
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]).toMatchObject({ esforco: 'medium' });
  const prompt = pedidos[0]!.prompt;
  expect(prompt).toContain('"Preços e produto"');
  expect(prompt).toContain('E1 [U1]');
  expect(prompt).toContain('### Relações');
  expect(prompt).not.toContain(modelo.elementos[0]!.id);

  const pronto = await situacao(api, caminho);
  expect(pronto.estado).toBe('pronto');
  const esquema = pronto.esquema!;
  expect(esquema).toMatchObject({ id: pendente.pedido_id, versao_id: versao.id, secao_id: secao.id, compreensao_id: execucao.id, modelo_id: modelo.id,
    titulo: 'Da hipótese à consequência', execucao: { modelo: 'modelo-de-teste', esforco: 'medium', prompt_versao: 'esquema-capitulo@2' } });
  expect(esquema.grupos.map((g) => g.id)).toEqual(['G1', 'G2']);
  const [n1, n2, n3, n4] = esquema.nos;
  const e1 = serializarModelo(modelo, blocos).apelidos.elementos.get('E1')!;
  expect(n1).toMatchObject({ elemento_id: e1.id, ancora: e1.ancoras[0] });
  expect(n2!.ancora).toMatchObject({ bloco_id: blocos[2]!.id, citacao: 'o cardápio impresso não muda todo dia' });
  expect(n3!.ancora).toBeUndefined();
  expect(n4!.ancora).toBeUndefined();
  expect(esquema.ligacoes).toEqual([{ de: 'N2', para: 'N1', rotulo: 'exemplifica', forca: 'fraca' }, { de: 'N1', para: 'N3', rotulo: 'leva a', forca: 'forte' }]);
  expect(esquema.diagnosticos.map((d) => d.codigo).sort()).toEqual(['citacao_ausente', 'elemento_inexistente', 'grupo_vazio', 'ligacao_descartada', 'ligacao_descartada']);
  const guardado = JSON.parse(await readFile(caminhoDoEsquema(versao.documento_id, versao.id, execucao.id, secao.id, esquema.id), 'utf8')) as EsquemaDoCapituloV1;
  expect(guardado).toEqual(esquema);

  // Gerar de novo: pedido novo; enquanto roda, o pronto anterior continua servido.
  const denovo = await (await api.request(caminho, { method: 'POST', headers: ESCRITA })).json() as Situacao;
  expect(denovo).toMatchObject({ estado: 'pendente', esquema: { id: esquema.id } });
  await rodar();
  const segundo = await situacao(api, caminho);
  expect(segundo).toMatchObject({ estado: 'pronto', esquema: { titulo: 'Segunda versão', id: denovo.pedido_id } });
  expect(segundo.esquema!.id).not.toBe(esquema.id);
}));

test('estrutura incoerente: segunda chamada com o erro; incoerente de novo, falha legível e o esquema anterior fica', async () => comBanco('esquema_corrigir', async (banco) => {
  const { canonico, execucao, secao, modelo } = await prepararCompreensao(banco);
  const boa = saidaBoa(modelo, canonico.blocos);
  const repetida = { ...boa, nos: [...boa.nos, { ...boa.nos[0]! }] };
  const { api, pedidos, rodar } = montar(banco, [
    { quando: { ordem: 1 }, tipo: 'ok', conteudo: repetida },
    { quando: { ordem: 2 }, tipo: 'ok', conteudo: boa },
    { quando: { ordem: 3 }, tipo: 'ok', conteudo: repetida },
    { quando: { ordem: 4 }, tipo: 'ok', conteudo: { ...boa, nos: boa.nos.map((no) => ({ ...no, grupo: 'G7' })) } },
  ]);
  const caminho = `/api/compreensoes/${execucao.id}/capitulos/${secao.id}/esquema`;
  await api.request(caminho, { method: 'POST', headers: ESCRITA });
  await rodar();
  expect(pedidos).toHaveLength(2);
  expect(pedidos[1]!.prompt).toContain('Correção pedida');
  expect(pedidos[1]!.prompt).toContain('há ids de nó repetidos');
  const pronto = await situacao(api, caminho);
  expect(pronto.estado).toBe('pronto');
  expect(pronto.esquema!.diagnosticos[0]).toMatchObject({ codigo: 'esquema_corrigido' });

  await api.request(caminho, { method: 'POST', headers: ESCRITA });
  await rodar();
  const falhou = await situacao(api, caminho);
  expect(falhou).toMatchObject({ estado: 'falhou', esquema: { id: pronto.esquema!.id } });
  expect(falhou.motivo).toContain('incoerente duas vezes');
  expect(falhou.motivo).toContain('grupos que não existem');
}));

test('recusas da API: compreensão inexistente, capítulo sem modelo, ids malformados', async () => comBanco('esquema_recusas', async (banco) => {
  const { canonico, execucao } = await prepararCompreensao(banco);
  const { api } = montar(banco, []);
  expect((await api.request(`/api/compreensoes/${canonico.secoes[0]!.id}/capitulos/${canonico.secoes[0]!.id}/esquema`)).status).toBe(404);
  expect((await api.request(`/api/compreensoes/${execucao.id}/capitulos/${canonico.secoes[2]!.id}/esquema`, { method: 'POST', headers: ESCRITA })).status).toBe(409);
  expect((await api.request(`/api/compreensoes/${execucao.id}/capitulos/xyz/esquema`)).status).toBe(400);
}));

test('régua da estrutura e montagem: poucos nós, grupo inexistente; prompt sem ids reais', () => {
  const base: SaidaDoEsquema = { titulo: 't', grupos: [{ id: 'G1', titulo: 'g', resumo: 'r' }], ligacoes: [],
    nos: [1, 2, 3].map((n) => ({ id: `N${String(n)}`, rotulo: `nó ${String(n)}`, tipo: 'conceito', grupo: 'G1', detalhe: 'd', elemento: null, citacao: null })) };
  expect(erroDoEsquema(base)).toBeNull();
  expect(erroDoEsquema({ ...base, nos: base.nos.slice(0, 2) })).toContain('pelo menos 3');
  expect(erroDoEsquema({ ...base, nos: base.nos.map((no) => ({ ...no, grupo: 'G2' })) })).toContain('grupos que não existem');
  expect(erroDoEsquema({ ...base, nos: base.nos.map((no) => ({ ...no, tipo: 'decisao' })) })).toContain('tipo desconhecido');
  const esquema = montarEsquema(base, { elementos: new Map(), unidades: new Map() }, [], {
    id: '01K0000000000000000000E001', versao_id: '01K0000000000000000000V001', secao_id: '01K0000000000000000000S001',
    compreensao_id: '01K0000000000000000000C001', modelo_id: '01K0000000000000000000M001',
    execucao: { modelo: 'm', esforco: 'medium', prompt_versao: 'esquema-capitulo@1' }, criado_em: '2026-09-30T12:00:00.000Z',
  });
  expect(validarEsquemaDoCapitulo(esquema), JSON.stringify(validarEsquemaDoCapitulo.errors)).toBe(true);
  expect(() => montarPromptDoEsquema({ documento: 'd', capitulo: 'c', modo: 'm' }, { elementos: [] } as unknown as ModeloDoCapituloV1, [], null)).toThrow('não tem elementos');
});
