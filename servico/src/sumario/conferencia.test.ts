/**
 * Conferência do sumário (J164): heurística → job leve do Codex (executor falso) → aviso na página do
 * documento → "Usar o sumário sugerido" muda só a apresentação do sumário, nunca o texto nem a versão.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type pg from 'pg';
import Ajv from 'ajv/dist/2020.js';
import { afterEach, expect, test } from 'vitest';
import type { CanonicoV1, EntradaDoSumarioSugerido } from '@margem/contratos';
import { canonicoDeTeste, comBanco, exigirMotorPython, idTeste, type BlocoDeTeste, type SecaoDeTeste } from '../../testes/apoio.js';
import { execFileSync } from 'node:child_process';
import { comandoDoMotor } from '../plataforma/executaveis.js';
import { comTransacao } from '../db/transacao.js';
import { executorAuditado } from '../executor/auditoria.js';
import { criarExecutorFalso, type Roteiro } from '../executor/fake.js';
import { criarApi } from '../http/app.js';
import { categoriaDoTipo } from '../modelos/categorias.js';
import { pausarParados, rotuloDoTrabalho } from '../pausa/pausa.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import {
  aoPublicarVersaoDoSumario, conferirProposta, entradasOriginais, lerSaidaDoSumario, manipuladoresDoSumario, montarPromptDoSumario, PropostaRecusada,
  lerSumarioOriginal, secoesDoPrompt, type EntradaOriginal,
} from './conferencia.js';
import { resumirSecoes, suspeitasDoSumario } from './heuristica.js';

const temporarios: string[] = [];
afterEach(async () => { for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });

const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
const pedir = (api: Hono, caminho: string, metodo = 'GET', dado?: unknown) =>
  Promise.resolve(api.request(caminho, { method: metodo, ...(metodo === 'GET' ? {} : { headers: ESCRITA }), ...(dado === undefined ? {} : { body: JSON.stringify(dado) }) }));

/** O defeito do Zero to One no motor antigo, em miniatura: "Preface" vazio, número e nome do capítulo separados. */
const BLOCOS: BlocoDeTeste[] = [
  { tipo: 'capitulo', texto: 'Preface' },                                 // 0  vazio
  { tipo: 'capitulo', texto: 'ZERO TO ONE' },                             // 1
  { tipo: 'paragrafo', texto: 'Every moment in business happens only once.' },
  { tipo: 'capitulo', texto: '1' },                                       // 3  vazio
  { tipo: 'capitulo', texto: 'THE CHALLENGE OF THE FUTURE' },             // 4
  { tipo: 'paragrafo', texto: 'Whenever I interview someone for a job, I like to ask this question.' },
  { tipo: 'secao', texto: 'STARTUP THINKING' },                           // 6
  { tipo: 'paragrafo', texto: 'New technology tends to come from new ventures.' },
  { tipo: 'capitulo', texto: '2' },                                       // 8  vazio
  { tipo: 'capitulo', texto: 'PARTY LIKE IT’S 1999' },                    // 9
  { tipo: 'paragrafo', texto: 'Our contrarian question is a hard one.' },
];
const SECOES: SecaoDeTeste[] = [
  { nivel: 1, inicio: 0, fim: 0 }, { nivel: 1, inicio: 1, fim: 2 }, { nivel: 1, inicio: 3, fim: 3 }, { nivel: 1, inicio: 4, fim: 7 },
  { nivel: 2, inicio: 6, fim: 7 }, { nivel: 1, inicio: 8, fim: 8 }, { nivel: 1, inicio: 9, fim: 10 },
];
const bloco = (i: number) => idTeste('B', i);
const livro = (formato: CanonicoV1['documento']['formato'] = 'epub'): CanonicoV1 => {
  const canonico = canonicoDeTeste({ blocos: BLOCOS, secoes: SECOES, titulo: 'Zero to One', idioma: 'en' });
  return { ...canonico, documento: { ...canonico.documento, formato } };
};
const ORIGINAL: EntradaOriginal[] = [
  { nivel: 1, titulo: 'Preface: Zero to One' }, { nivel: 1, titulo: '1. The Challenge of the Future' }, { nivel: 1, titulo: '2. Party Like It’s 1999' },
];
const PROPOSTA: EntradaDoSumarioSugerido[] = [
  { titulo: 'Preface: Zero to One', nivel: 1, bloco_inicio: bloco(1) },
  { titulo: '1. The Challenge of the Future', nivel: 1, bloco_inicio: bloco(4) },
  { titulo: 'Startup Thinking', nivel: 2, bloco_inicio: bloco(6) },
  { titulo: '2. Party Like It’s 1999', nivel: 1, bloco_inicio: bloco(9) },
];
const RESPOSTA = { ok: false, problemas: ['O número de cada capítulo virou um capítulo vazio, separado do nome.'], proposta: PROPOSTA };

test('o prompt leva as seções e o sumário do arquivo; o schema só aceita bloco_inicio de seções existentes', () => {
  const canonico = livro();
  const suspeitas = suspeitasDoSumario(resumirSecoes(canonico), 40);
  expect(suspeitas.map((suspeita) => suspeita.codigo)).toEqual(['titulo_so_numero', 'numero_seguido_de_titulo', 'secoes_vazias']);
  const { prompt, schema } = montarPromptDoSumario({ titulo: 'Zero to One', formato: 'epub', canonico, suspeitas, original: ORIGINAL });
  expect(prompt).not.toMatch(/\{\{[a-z_]+\}\}/u);
  for (const trecho of [`[${bloco(4)}] 1 · THE CHALLENGE OF THE FUTURE · 21 (13) · Whenever I interview`, `[${bloco(3)}] 1 · 1 · 0 (0) · —`,
    '- 1. The Challenge of the Future', 'Palavras no texto: 35', 'só um número']) expect(prompt).toContain(trecho);
  const validar = new Ajv({ strict: true }).compile(schema);
  expect(validar({ ...RESPOSTA })).toBe(true);
  expect(validar({ ...RESPOSTA, proposta: [{ titulo: 'Inventada', nivel: 1, bloco_inicio: idTeste('B', 99) }] })).toBe(false);
  expect(validar({ ok: true, problemas: [] })).toBe(false);
  expect(montarPromptDoSumario({ titulo: 'Zero to One', formato: 'epub', canonico, suspeitas, original: null }).prompt).toContain('(o arquivo não declara sumário)');
});

test('a proposta só renomeia, deixa de fora capítulos vazios e mexe no nível de subseções', () => {
  const secoes = secoesDoPrompt(livro());
  expect(() => conferirProposta(secoes, PROPOSTA, ORIGINAL)).not.toThrow();
  // Sem o sumário do arquivo, as palavras ainda vêm dos títulos vizinhos ("1" + "THE CHALLENGE…").
  expect(() => conferirProposta(secoes, PROPOSTA, null)).not.toThrow();
  const recusa = (proposta: EntradaDoSumarioSugerido[], original: EntradaOriginal[] | null = ORIGINAL) => {
    try { conferirProposta(secoes, proposta, original); return null; } catch (erro) { if (erro instanceof PropostaRecusada) return erro.message; throw erro; }
  };
  const trocar = (indice: number, entrada: Partial<EntradaDoSumarioSugerido>) => PROPOSTA.map((atual, i) => (i === indice ? { ...atual, ...entrada } : atual));
  expect(recusa(trocar(1, { titulo: '1. The Challenge of Tomorrow' }))).toBe('O título "1. The Challenge of Tomorrow" traz uma palavra que não está no livro: "tomorrow".');
  expect(recusa(trocar(1, { bloco_inicio: bloco(5) }))).toMatch(/não começa numa seção existente/u);
  expect(recusa([PROPOSTA[1]!, PROPOSTA[0]!, ...PROPOSTA.slice(2)])).toMatch(/fora de ordem/u);
  expect(recusa(trocar(2, { nivel: 1 }))).toMatch(/viraria capítulo/u);
  expect(recusa(trocar(3, { nivel: 2 }))).toMatch(/deixaria de ser capítulo/u);
  expect(recusa(trocar(2, { nivel: 3 }))).toMatch(/pula um nível/u);
  expect(recusa(PROPOSTA.filter((_, i) => i !== 3))).toBe('O capítulo "PARTY LIKE IT’S 1999" tem texto e ficaria de fora.');
  // Manter um capítulo vazio também vale; a subseção pode sair (o texto dela continua no capítulo).
  expect(recusa([{ titulo: 'Preface', nivel: 1, bloco_inicio: bloco(0) }, ...PROPOSTA.filter((_, i) => i !== 2)])).toBeNull();

  // A resposta: `ok` ignora a proposta; lista vazia = sem proposta; proposta ruim cai, os problemas ficam.
  expect(lerSaidaDoSumario({ ok: true, problemas: [], proposta: PROPOSTA }, secoes, ORIGINAL)).toEqual({ resposta: { ok: true, problemas: [] }, recusa: null });
  expect(lerSaidaDoSumario({ ...RESPOSTA, proposta: [] }, secoes, ORIGINAL).resposta).toEqual({ ok: false, problemas: RESPOSTA.problemas });
  const ruim = lerSaidaDoSumario({ ...RESPOSTA, proposta: trocar(3, { nivel: 2 }) }, secoes, ORIGINAL);
  expect(ruim.resposta).toEqual({ ok: false, problemas: RESPOSTA.problemas });
  expect(ruim.recusa).toMatch(/deixaria de ser capítulo/u);
  expect(() => lerSaidaDoSumario({ ...RESPOSTA, extra: 1 }, secoes, ORIGINAL)).toThrow(/fora do contrato/u);
  expect(entradasOriginais({ entradas: [{ nivel: 9, titulo: '  Um\n título ' }, { nivel: 1, titulo: '' }, 'x'] })).toEqual([{ nivel: 6, titulo: 'Um título' }]);
  expect(entradasOriginais({})).toBeNull();
});

async function montar(banco: pg.Pool, roteiro: Roteiro) {
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-sumario-art-'));
  const auditoria = await mkdtemp(join(tmpdir(), 'margem-sumario-aud-'));
  const slots = await mkdtemp(join(tmpdir(), 'margem-sumario-slots-'));
  temporarios.push(artefatos, auditoria, slots);
  const falso = criarExecutorFalso(roteiro);
  const pedidos: { esforco?: string | undefined; prompt: string }[] = [];
  const executor = executorAuditado((pedido) => { pedidos.push({ esforco: pedido.esforco, prompt: pedido.prompt }); return falso({ ...pedido, diretorioArtefatos: artefatos }); }, { commit: () => 'teste' });
  const manipuladores = manipuladoresDoSumario({ banco, executor, modelo: 'modelo-de-teste', esforco: 'low', lerOriginal: () => Promise.resolve(ORIGINAL) });
  const rodar = () => new Worker({ fila: new FilaPostgres(banco), manipuladores, auditoria, slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();
  return { rodar, pedidos, api: criarApi({ banco, leitura: () => { throw new Error('não usada'); } }) };
}

async function documentoDoLivro(banco: pg.Pool, canonico = livro()) {
  return comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: '/tmp/zero-to-one.epub' });
    const versao = await documentos.criarVersao(cliente, criado.id, canonico);
    return { documento: criado, versao };
  });
}

interface Arvore { capitulos: { id: string; titulo: string }[]; capitulos_ocultos?: string[]; secoes: { titulo: string; nivel: number; filhos: { titulo: string }[] }[]; capitulo_do_bloco?: string | null }

test('suspeito: o Codex confere com pouco esforço, a página avisa, e usar a sugestão não toca no texto', async () => comBanco('sumario_conferido', async (banco) => {
  const { documento, versao } = await documentoDoLivro(banco);
  const { rodar, pedidos, api } = await montar(banco, { versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: RESPOSTA }] });
  const job = await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, documento.id, versao, versao.canonico));
  expect(job).toMatchObject({ tipo: 'conferir_sumario', dedup_key: `conferir_sumario:${versao.id}`, documento_id: documento.id });
  // Enquanto confere, a página não avisa nada.
  expect(await (await pedir(api, `/api/documentos/${documento.id}/sumario`)).json()).toMatchObject({ situacao: { estado: 'conferindo', depois: null } });
  // É trabalho do Codex como os outros: tem rótulo na pausa e categoria nos modelos.
  expect(rotuloDoTrabalho('conferir_sumario')).toBe('Conferir o sumário');
  expect(categoriaDoTipo('conferir_sumario')?.id).toBe('tipo_de_texto');

  await rodar();
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]?.esforco).toBe('low');
  expect(pedidos[0]?.prompt).toContain('- 2. Party Like It’s 1999');
  const { situacao } = await (await pedir(api, `/api/documentos/${documento.id}/sumario`)).json() as { situacao: { estado: string; problemas: string[]; antes: unknown[]; depois: unknown[] } };
  expect(situacao.estado).toBe('suspeito');
  expect(situacao.problemas).toEqual(RESPOSTA.problemas);
  expect(situacao.antes).toHaveLength(7);
  expect(situacao.depois).toEqual(PROPOSTA.map(({ titulo, nivel }) => ({ titulo, nivel })));

  const arvore = async (bloco?: string) => await (await pedir(api, `/api/versoes/${versao.id}/secoes${bloco ? `?bloco=${bloco}` : ''}`)).json() as Arvore;
  expect((await arvore()).capitulos.map((capitulo) => capitulo.titulo)).toEqual(['Preface', 'ZERO TO ONE', '1', 'THE CHALLENGE OF THE FUTURE', '2', 'PARTY LIKE IT’S 1999']);
  const marcasAntes = Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM marca')).rows[0]?.n);

  expect((await pedir(api, `/api/documentos/${documento.id}/sumario`, 'POST', { decisao: 'talvez' })).status).toBe(400);
  const usada = await pedir(api, `/api/documentos/${documento.id}/sumario`, 'POST', { decisao: 'usar' });
  expect(usada.status).toBe(200);
  expect(await usada.json()).toMatchObject({ situacao: { estado: 'aplicada' } });
  const depois = await arvore(bloco(3));
  expect(depois.capitulos).toEqual([
    { id: idTeste('S', 1), titulo: 'Preface: Zero to One' }, { id: idTeste('S', 3), titulo: '1. The Challenge of the Future' },
    { id: idTeste('S', 6), titulo: '2. Party Like It’s 1999' },
  ]);
  expect(depois.secoes[1]?.filhos.map((filho) => filho.titulo)).toEqual(['Startup Thinking']);
  // A posição salva no "1" (que saiu do sumário) reabre no capítulo seguinte, o do nome.
  expect(depois.capitulo_do_bloco).toBe(idTeste('S', 3));
  expect((await arvore(bloco(5))).capitulo_do_bloco).toBe(idTeste('S', 3));
  // Nada no texto: a mesma versão, o mesmo canônico, as mesmas marcas.
  const versoes = (await banco.query<{ id: string; canonico: CanonicoV1 }>('SELECT id, canonico FROM versao_texto WHERE documento_id=$1', [documento.id])).rows;
  expect(versoes.map((linha) => linha.id)).toEqual([versao.id]);
  expect(versoes[0]?.canonico.secoes).toEqual(versao.canonico.secoes);
  expect(Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM marca')).rows[0]?.n)).toBe(marcasAntes);
  // Os capítulos de verdade continuam abrindo (a leitura, as análises e os grifos usam as seções do canônico).
  expect((await pedir(api, `/api/versoes/${versao.id}/capitulos/${idTeste('S', 3)}`)).status).toBe(200);
  // R3-2: anterior/próximo seguem o sumário apresentado; um capítulo que saiu ainda abre por link, entre os vizinhos visíveis.
  const vizinhos = async (secao: string) => {
    const { anterior, proxima } = await (await pedir(api, `/api/versoes/${versao.id}/capitulos/${secao}`)).json() as { anterior: string | null; proxima: string | null };
    return [anterior, proxima];
  };
  expect(await vizinhos(idTeste('S', 1))).toEqual([null, idTeste('S', 3)]);
  expect(await vizinhos(idTeste('S', 3))).toEqual([idTeste('S', 1), idTeste('S', 6)]);
  expect(await vizinhos(idTeste('S', 6))).toEqual([idTeste('S', 3), null]);
  expect(await vizinhos(idTeste('S', 2))).toEqual([idTeste('S', 1), idTeste('S', 3)]);
  expect(depois.capitulos_ocultos).toEqual(versao.canonico.secoes
    .filter((secao) => secao.nivel === 1 && ![1, 3, 6].some((n) => idTeste('S', n) === secao.id)).map((secao) => secao.id));
  expect(depois.capitulos_ocultos).toContain(idTeste('S', 2));

  // "Voltar ao original" (manter) desfaz; usar de novo volta à sugestão.
  expect(await (await pedir(api, `/api/documentos/${documento.id}/sumario`, 'POST', { decisao: 'manter' })).json()).toMatchObject({ situacao: { estado: 'mantida' } });
  expect((await arvore()).capitulos).toHaveLength(6);
  expect((await pedir(api, `/api/documentos/${documento.id}/sumario`, 'POST', { decisao: 'usar' })).status).toBe(200);
  expect((await arvore()).capitulos).toHaveLength(3);
}));

test('proposta que inventa palavras é recusada; os problemas ainda aparecem, sem sugestão', async () => comBanco('sumario_recusado', async (banco) => {
  const { documento, versao } = await documentoDoLivro(banco);
  const inventada = { ...RESPOSTA, proposta: PROPOSTA.map((entrada, i) => (i === 1 ? { ...entrada, titulo: '1. Tomorrow' } : entrada)) };
  const { rodar, api } = await montar(banco, { versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: inventada }] });
  await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, documento.id, versao, versao.canonico));
  await rodar();
  const { situacao } = await (await pedir(api, `/api/documentos/${documento.id}/sumario`)).json() as { situacao: { estado: string; depois: unknown } };
  expect(situacao).toMatchObject({ estado: 'suspeito', depois: null });
  const job = (await banco.query<{ estado: string; diagnosticos: { codigo: string }[] }>("SELECT estado, diagnosticos FROM job WHERE tipo='conferir_sumario'")).rows[0];
  expect(job?.estado).toBe('ok');
  expect(job?.diagnosticos.map((diagnostico) => diagnostico.codigo)).toEqual(['sumario_suspeito', 'sugestao_recusada']);
  expect((await pedir(api, `/api/documentos/${documento.id}/sumario`, 'POST', { decisao: 'usar' })).status).toBe(409);
  expect(await (await pedir(api, `/api/documentos/${documento.id}/sumario`, 'POST', { decisao: 'manter' })).json()).toMatchObject({ situacao: { estado: 'mantida' } });
}));

test('sem Codex: livro sem suspeita, formato sem sumário, versão nova de documento antigo, conferência desligada; e a pausa', async () => comBanco('sumario_sem_codex', async (banco) => {
  const { api } = await montar(banco, { versao: 1, passos: [] });
  const contarJobs = async () => Number((await banco.query<{ n: string }>("SELECT count(*) AS n FROM job WHERE tipo='conferir_sumario'")).rows[0]?.n);
  // Bem estruturado: grava `ok`, sem job, sem aviso.
  const limpo = canonicoDeTeste({ blocos: [{ tipo: 'capitulo', texto: 'Um' }, { tipo: 'paragrafo', texto: 'Texto.' }, { tipo: 'capitulo', texto: 'Dois' }, { tipo: 'paragrafo', texto: 'Mais.' }],
    secoes: [{ nivel: 1, inicio: 0, fim: 1 }, { nivel: 1, inicio: 2, fim: 3 }] });
  const bom = await documentoDoLivro(banco, { ...limpo, documento: { ...limpo.documento, formato: 'pdf' } });
  expect(await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, bom.documento.id, bom.versao, bom.versao.canonico))).toBeNull();
  expect(await (await pedir(api, `/api/documentos/${bom.documento.id}/sumario`)).json()).toMatchObject({ situacao: { estado: 'ok' } });
  // Markdown, TXT, colado: não há sumário do arquivo para conferir.
  const md = await documentoDoLivro(banco, livro('md'));
  expect(await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, md.documento.id, md.versao, md.versao.canonico))).toBeNull();
  expect(await (await pedir(api, `/api/documentos/${md.documento.id}/sumario`)).json()).toEqual({ situacao: null });
  // Recanonizar um documento que já estava na biblioteca (versão 2) não confere.
  const antigo = await documentoDoLivro(banco);
  expect(await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, antigo.documento.id, { ...antigo.versao, numero: 2 }, antigo.versao.canonico))).toBeNull();
  expect(await contarJobs()).toBe(0);
  // Desligada nas Configurações.
  expect(await (await pedir(api, '/api/configuracoes/sumario')).json()).toEqual({ conferir_ao_importar: true });
  expect((await pedir(api, '/api/configuracoes/sumario', 'PUT', { conferir_ao_importar: 'sim' })).status).toBe(400);
  expect(await (await pedir(api, '/api/configuracoes/sumario', 'PUT', { conferir_ao_importar: false })).json()).toEqual({ conferir_ao_importar: false });
  expect(await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, antigo.documento.id, antigo.versao, antigo.versao.canonico))).toBeNull();
  expect(await contarJobs()).toBe(0);
  // Ligada de novo: o job entra e, parado desde antes de o app abrir, vai para a pausa como os outros do Codex.
  await pedir(api, '/api/configuracoes/sumario', 'PUT', { conferir_ao_importar: true });
  const job = await comTransacao(banco, (cliente) => aoPublicarVersaoDoSumario(cliente, antigo.documento.id, antigo.versao, antigo.versao.canonico));
  expect(job?.tipo).toBe('conferir_sumario');
  const pausa = await comTransacao(banco, (cliente) => pausarParados(cliente, { partida: new Date(Date.now() + 10 * 3_600_000), esperaMs: 3_600_000 }));
  expect(pausa.jobs).toEqual([job?.id]);
}));

test('o sumário do próprio arquivo vem do motor; sem arquivo, lista vazia', async () => {
  await exigirMotorPython();
  const pasta = await mkdtemp(join(tmpdir(), 'margem-sumario-pdf-'));
  temporarios.push(pasta);
  const pdf = join(pasta, 'com-toc.pdf');
  const python = comandoDoMotor('ingest', []).programa;
  execFileSync(python, ['-c', `import pymupdf, sys
d = pymupdf.open(); d.new_page(); d.new_page()
d.set_toc([[1, 'Introdução', 1], [2, 'Um detalhe', 1], [1, 'Fim', 2]]); d.save(sys.argv[1])`, pdf]);
  expect(await lerSumarioOriginal(pdf, 'pdf')).toEqual([{ nivel: 1, titulo: 'Introdução' }, { nivel: 2, titulo: 'Um detalhe' }, { nivel: 1, titulo: 'Fim' }]);
  expect(await lerSumarioOriginal(join(pasta, 'nao-existe.epub'), 'epub')).toEqual([]);
});
