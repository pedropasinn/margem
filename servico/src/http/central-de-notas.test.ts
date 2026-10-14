/**
 * Central de Notas (J145): `GET /api/notas/central` reúne, numa lista paginada e agregada no banco, tudo de todos
 * os documentos: grifos do leitor e do Codex (com nota e comentário), relações (conexões e as da leitura do
 * Codex), dificuldades (sinais e sugestões do modelo), resoluções, flashcards, perguntas e visuais; filtros,
 * facetas, ordem e o que abrir no leitor. E a migração 0035 indexa os modelos que já existiam.
 * Postgres de teste e executor falso, sem Codex.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, expect, test } from 'vitest';
import type { AncoraV1, Bloco, CanonicoV1, MarcaV2 } from '@margem/contratos';
import { canonicoDeTeste, comBanco, idTeste } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { iniciarCompreensao, prepararCapitulo } from '../compreensao/pipeline.js';
import { comBancoDeTeste } from '../db/conexao.js';
import { migracoesPendentes, migrar } from '../db/migrar.js';
import { comTransacao } from '../db/transacao.js';
import { exigirModo } from '../modos.js';
import type { ItemDaCentral, PaginaDaCentral } from '../notas/central.js';
import * as compreensao from '../repos/compreensao.js';
import * as documentos from '../repos/documentos.js';
import { criarApi } from './app.js';

const temporarios: string[] = [];
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });

const RESOLUCAO = idTeste('R', 1);
const VISUAL_1 = idTeste('V', 1);
const VISUAL_2 = idTeste('V', 2);
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };
async function escrever<T>(api: Hono, metodo: string, caminho: string, dado: unknown): Promise<T> {
  const resposta = await api.request(caminho, { method: metodo, headers: ESCRITA, body: JSON.stringify(dado) });
  expect(resposta.status, await resposta.clone().text()).toBeLessThan(300);
  return await resposta.json() as T;
}
async function central(api: Hono, consulta = ''): Promise<PaginaDaCentral> {
  const resposta = await api.request(`/api/notas/central${consulta}`);
  expect(resposta.status, await resposta.clone().text()).toBe(200);
  return await resposta.json() as PaginaDaCentral;
}
function ancora(versaoId: string, bloco: Bloco, citacao: string): AncoraV1 {
  const inicio = bloco.texto.indexOf(citacao);
  if (inicio < 0) throw new Error(`Trecho fora do bloco: ${citacao}`);
  return { versao_id: versaoId, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + citacao.length,
    citacao, prefixo: bloco.texto.slice(0, inicio), sufixo: bloco.texto.slice(inicio + citacao.length) };
}

/** Um livro com o capítulo um preparado pelo Codex (até a revisão 2), num banco já migrado. */
async function livroPreparado(banco: Parameters<typeof criarApi>[0]['banco']): Promise<{ canonico: CanonicoV1; versaoId: string; documentoId: string; execucaoId: string }> {
  const canonico = livro();
  const { versaoId, documentoId } = await comTransacao(banco, async (cliente) => {
    const d = await documentos.criar(cliente, { ...canonico.documento, autor: 'Autora', origem_caminho: 'precos.md' });
    return { documentoId: d.id, versaoId: (await documentos.criarVersao(cliente, d.id, canonico)).id };
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versaoId, exigirModo({ id: 'argumentativa', revisao: 1 }));
  await prepararCapitulo(config, execucao.id, canonico.secoes[0]!.id);
  const slots = await mkdtemp(join(tmpdir(), 'margem-j145-')); temporarios.push(slots);
  for (let i = 0; i < 3; i += 1) await rodarUm(banco, config, auditoria, slots);
  const r2 = await comTransacao(banco, (cliente) => compreensao.revisaoDoCapitulo(cliente, execucao.id, canonico.secoes[0]!.id));
  if (r2?.revisao !== 2) throw new Error('O pipeline não publicou a revisão 2.');
  return { canonico, versaoId, documentoId, execucaoId: execucao.id };
}

test('central: tudo de todos os documentos, com filtros, facetas, páginas, ordem e o lugar exato no leitor', async () => comBanco('central_notas', async (banco) => {
  const { canonico, versaoId, documentoId, execucaoId } = await livroPreparado(banco);
  const outro = canonicoDeTeste({ titulo: 'Ética breve', blocos: [{ tipo: 'capitulo', texto: 'Um' }, { tipo: 'paragrafo', texto: 'A virtude está no meio, diz o texto curto.' }],
    secoes: [{ nivel: 1, inicio: 0, fim: 1 }] });
  const { versaoOutro, outroId } = await comTransacao(banco, async (cliente) => {
    const d = await documentos.criar(cliente, { ...outro.documento, origem_caminho: 'etica.md' });
    return { outroId: d.id, versaoOutro: (await documentos.criarVersao(cliente, d.id, outro)).id };
  });
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } });

  // Antes do leitor: o que o Codex deixou (grifos projetados, relações e dificuldades sugeridas do modelo).
  const inicial = await central(api, '?facetas=1&limite=200');
  expect(inicial.itens.every((item) => item.autoria === 'codex')).toBe(true);
  const relacoesDaLeitura = inicial.itens.filter((item) => item.tipo === 'relacao');
  expect(relacoesDaLeitura.length).toBeGreaterThan(0);
  const exemplifica = relacoesDaLeitura.find((item) => item.rotulo === 'Exemplifica');
  expect(exemplifica).toMatchObject({ estado: 'da_leitura', texto: 'O cardápio exemplifica a rigidez.', citacao: 'o cardápio impresso não muda todo dia',
    destino: { citacao: 'Admitamos inicialmente que os preços são rígidos', documento: { id: documentoId } },
    abrir: { painel: 'relacao', documento_id: documentoId, secao_id: canonico.secoes[0]!.id } });
  const sugeridas = inicial.itens.filter((item) => item.tipo === 'dificuldade');
  expect(sugeridas.map((item) => item.estado)).toEqual(sugeridas.map(() => 'sugerida'));
  expect(sugeridas.map((item) => item.rotulo)).toEqual(['Salto no argumento']);
  const grifosDoCodex = inicial.itens.filter((item) => item.tipo === 'grifo');
  expect(grifosDoCodex.length).toBeGreaterThan(0);
  expect(grifosDoCodex.every((item) => item.modo?.id === 'argumentativa' && item.abrir.painel === 'balao')).toBe(true);
  expect(inicial.facetas?.autorias).toEqual({ leitor: 0, codex: inicial.total });
  expect(inicial.facetas?.documentos.map((d) => d.id)).toEqual([documentoId]);

  // O leitor: grifo com nota (aqui e no outro documento), nota num grifo do Codex, conexão, dificuldade sua,
  // decide uma dificuldade sugerida, flashcard e pergunta presa a um trecho.
  const [, p1, p2, , p3] = canonico.blocos as [Bloco, Bloco, Bloco, Bloco, Bloco];
  const { marca } = await escrever<{ marca: MarcaV2 }>(api, 'POST', '/api/grifos', { ancora: ancora(versaoId, p2, 'Um exemplo ilustra'), funcao: 'tese' });
  await escrever(api, 'PUT', `/api/marcas/${marca.id}/nota-do-leitor`, { texto: 'O exemplo segura a tese.' });
  const codexGrifo = grifosDoCodex[0]!;
  await escrever(api, 'PUT', `/api/marcas/${codexGrifo.id}/nota-do-leitor`, { texto: 'Concordo com o Codex.' });
  const [, q1] = outro.blocos as [Bloco, Bloco];
  const { marca: noOutro } = await escrever<{ marca: MarcaV2 }>(api, 'POST', '/api/grifos', { ancora: ancora(versaoOutro, q1, 'A virtude está no meio'), funcao: 'tese' });
  await escrever(api, 'PUT', `/api/marcas/${noOutro.id}/nota-do-leitor`, { texto: 'Aristóteles, de novo.' });
  const { conexao } = await escrever<{ conexao: { id: string } }>(api, 'POST', '/api/conexoes', {
    origem: ancora(versaoId, p3, 'o choque reduz o produto'), destino: { tipo: 'trecho', ancora: ancora(versaoOutro, q1, 'no meio') },
    relacao: 'contraste', justificativa: 'Meio-termo contra choque.' });
  await escrever(api, 'POST', '/api/dificuldades', { ancora: ancora(versaoId, p1, 'rígidos'), tipo: 'ambiguidade' });
  const modelo = await comTransacao(banco, (cliente) => compreensao.revisaoDoCapitulo(cliente, execucaoId, canonico.secoes[0]!.id));
  const confirmada = sugeridas.find((item) => item.rotulo === 'Salto no argumento')!;
  await escrever(api, 'POST', '/api/dificuldades/codex', { modelo_id: modelo!.id, dificuldade_id: confirmada.id, estado: 'confirmada' });
  const { dificuldade: descartada } = await escrever<{ dificuldade: { id: string } }>(api, 'POST', '/api/dificuldades', { ancora: ancora(versaoId, p3, 'somente'), tipo: 'sintaxe_complexa' });
  await escrever(api, 'PATCH', `/api/dificuldades/${descartada.id}`, { estado: 'descartada' });
  await escrever(api, 'POST', '/api/flashcards', { ancora: ancora(versaoId, p2, 'cardápio impresso'), frente: 'O que ilustra a rigidez?', verso: 'O cardápio impresso.' });
  const { conversa } = await escrever<{ conversa: { id: string } }>(api, 'POST', '/api/conversas', { ancora: ancora(versaoId, p1, 'inicialmente'), pergunta: 'Por que "inicialmente"?' });
  // Resolução (recorte) e visual vêm de jobs do Codex: gravados direto, como o worker os deixaria.
  await banco.query(`INSERT INTO resolucao (id, documento_id, versao_id, dados, criada_em) VALUES ($1,$2,$3,$4,clock_timestamp())`, [RESOLUCAO, documentoId, versaoId,
    JSON.stringify({ versao: 2, id: RESOLUCAO, documento_id: documentoId, versao_id: versaoId,
      origem: { tipo: 'trecho', ancora: ancora(versaoId, p3, 'Logo') }, texto_extraido: 'Logo, somente com preços rígidos.',
      resolucao: { enunciado: 'Mostre que o choque reduz o produto.', legibilidade: 'boa', conceitos: [], observacao: null,
        itens: [{ rotulo: '', enunciado: 'x', estrategia: 'Partir da rigidez.', passos: [], resposta: 'Reduz.', verificacao: null }] },
      execucao: null, mensagens: [], criada_em: new Date().toISOString() })]);
  await banco.query(`INSERT INTO visual (id, versao_id, secao_id, tipo, alvo, pedido) VALUES ($3,$1,$2,'diagrama','{"tipo":"capitulo"}','O argumento em etapas')`,
    [versaoId, canonico.secoes[0]!.id, VISUAL_1]);
  await banco.query(`INSERT INTO visual (id, versao_id, secao_id, tipo, alvo, pedido, substitui) VALUES ($3,$1,$2,'diagrama','{"tipo":"capitulo"}','De novo',$4)`,
    [versaoId, canonico.secoes[0]!.id, VISUAL_2, VISUAL_1]);

  const tudo = await central(api, '?facetas=1&limite=200');
  const porTipo = (tipo: string) => tudo.itens.filter((item) => item.tipo === tipo);
  const chaves = new Set(tudo.itens.map((item) => item.chave));
  expect(chaves.size).toBe(tudo.itens.length);
  expect(tudo.total).toBe(tudo.itens.length);
  // Grifo do leitor com a nota: abre o balão já na nota, no lugar exato.
  expect(tudo.itens.find((item) => item.id === marca.id)).toMatchObject({ tipo: 'grifo', autoria: 'leitor', rotulo: 'Tese', nota: 'O exemplo segura a tese.',
    capitulo: { id: canonico.secoes[0]!.id, titulo: 'Capítulo um' },
    abrir: { painel: 'nota', alvo_id: marca.id, bloco_id: p2.id, faixa: { inicio_utf16: 0, fim_utf16: 'Um exemplo ilustra'.length } } });
  // Grifo do Codex com nota do leitor: continua do Codex, mas entra em "meus" pela nota.
  expect(tudo.itens.find((item) => item.id === codexGrifo.id)).toMatchObject({ autoria: 'codex', nota: 'Concordo com o Codex.' });
  // Conexão do leitor com os dois trechos, em outro documento.
  expect(tudo.itens.find((item) => item.id === conexao.id)).toMatchObject({ tipo: 'relacao', autoria: 'leitor', rotulo: 'Contraste', estado: 'aceita',
    texto: 'Meio-termo contra choque.', destino: { citacao: 'no meio', documento: { id: outroId, titulo: 'Ética breve' }, abrir: { documento_id: outroId, bloco_id: q1.id } },
    abrir: { painel: 'conexao', alvo_id: conexao.id } });
  // Dificuldades: a do leitor, a confirmada (uma só, agora gravada) e nenhuma descartada.
  expect(porTipo('dificuldade').map((item) => [item.autoria, item.rotulo, item.estado]).sort()).toEqual([
    ['codex', 'Salto no argumento', 'confirmada'], ['leitor', 'Ambiguidade', 'confirmada']]);
  expect(porTipo('resolucao')).toMatchObject([{ autoria: 'codex', citacao: 'Mostre que o choque reduz o produto.', texto: 'Partir da rigidez.', comentario: 'Reduz.',
    estado: 'pronta', abrir: { painel: 'resolucao', alvo_id: RESOLUCAO, bloco_id: p3.id } }]);
  expect(porTipo('flashcard')).toMatchObject([{ autoria: 'leitor', texto: 'O que ilustra a rigidez?', comentario: 'O cardápio impresso.', abrir: { painel: 'flashcards' } }]);
  expect(porTipo('conversa')).toMatchObject([{ id: conversa.id, autoria: 'leitor', texto: 'Por que "inicialmente"?', mensagens: 1, abrir: { painel: 'conversa', alvo_id: conversa.id } }]);
  // Só o visual mais novo da série.
  expect(porTipo('visual')).toMatchObject([{ id: VISUAL_2, rotulo: 'Diagrama', texto: 'De novo', estado: 'pendente', abrir: { painel: 'visual', bloco_id: canonico.blocos[0]!.id } }]);

  // Facetas: cada contagem com os outros filtros.
  expect(tudo.facetas?.tipos).toMatchObject({ total: tudo.total, nota: 3, flashcard: 1, conversa: 1, resolucao: 1, visual: 1, dificuldade: 2 });
  expect(tudo.facetas?.documentos.map((d) => d.titulo)).toEqual(['Ética breve', 'Preços e produto']);
  expect(tudo.facetas?.funcoes.some((f) => f.funcao === 'tese' && f.cor !== null)).toBe(true);
  const meus = await central(api, '?autoria=leitor&facetas=1');
  expect(meus.itens.map((item) => item.tipo).sort()).toEqual(['conversa', 'dificuldade', 'flashcard', 'grifo', 'grifo', 'grifo', 'relacao']);
  expect(meus.facetas?.tipos.flashcard).toBe(1);
  expect(meus.facetas?.autorias.codex).toBe(tudo.facetas?.autorias.codex);

  // Filtros.
  expect((await central(api, '?tipo=nota')).itens.map((item) => item.nota).sort()).toEqual(['Aristóteles, de novo.', 'Concordo com o Codex.', 'O exemplo segura a tese.']);
  expect((await central(api, '?tipo=comentario')).itens.every((item) => item.tipo === 'grifo' && item.comentario !== null)).toBe(true);
  expect((await central(api, `?documento=${outroId}`)).itens.map((item) => item.tipo).sort()).toEqual(['grifo']);
  expect((await central(api, '?texto=VIRTUDE')).itens.map((item) => item.documento.id)).toEqual([outroId]);
  expect((await central(api, '?texto=meio-termo')).itens.map((item) => item.id)).toEqual([conexao.id]);
  expect((await central(api, '?funcao=tese&modo=argumentativa')).itens.every((item) => item.funcao === 'tese' && item.modo?.id === 'argumentativa')).toBe(true);
  expect((await central(api, '?desde=2999-01-01')).total).toBe(0);
  expect((await central(api, '?ate=2000-01-01')).total).toBe(0);

  // Páginas: a soma das páginas é a lista inteira, sem repetir; além do fim, vazio com o total.
  const vistos: string[] = [];
  for (let deslocamento = 0; deslocamento < tudo.total; deslocamento += 4) {
    const pagina = await central(api, `?limite=4&deslocamento=${String(deslocamento)}`);
    expect(pagina.total).toBe(tudo.total);
    vistos.push(...pagina.itens.map((item) => item.chave));
  }
  expect(vistos).toEqual(tudo.itens.map((item) => item.chave));
  expect(await central(api, '?limite=4&deslocamento=9999')).toMatchObject({ itens: [], total: tudo.total });

  // Ordem por documento: títulos em português ("Ética" antes de "Preços"), e no documento a ordem do texto.
  const porDocumento = (await central(api, '?ordem=documento&limite=200')).itens;
  expect(porDocumento[0]!.documento.titulo).toBe('Ética breve');
  const ordemNoTexto = porDocumento.filter((item) => item.documento.id === documentoId)
    .map((item) => [canonico.blocos.findIndex((bloco) => bloco.id === item.abrir.bloco_id), item.abrir.faixa?.inicio_utf16 ?? 0] as const);
  expect(ordemNoTexto).toEqual([...ordemNoTexto].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  const antigos = (await central(api, '?ordem=antigos&limite=200')).itens.map((item: ItemDaCentral) => item.criada_em);
  expect(antigos).toEqual([...antigos].sort());

  // Entradas inválidas.
  for (const consulta of ['?tipo=tudo', '?autoria=eu', '?ordem=sorte', '?desde=ontem', '?limite=-1', '?documento=nao-e-ulid', `?texto=${'x'.repeat(201)}`]) {
    expect((await api.request(`/api/notas/central${consulta}`)).status, consulta).toBe(400);
  }
}));

test('0035 indexa as relações e dificuldades dos modelos publicados antes dela; novos modelos entram pelo gatilho', async () => comBancoDeTeste('migracao_central', async (banco) => {
  await migrar(banco, { ate: '0034_analise_do_video.sql' });
  expect((await migracoesPendentes(banco))[0]).toBe('0035_central_de_notas.sql');
  // O pipeline grava no esquema até a 0034 (sem a tabela nova): um modelo "antigo".
  const canonico = livro();
  const versaoId = await comTransacao(banco, async (cliente) => {
    const d = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'precos.md' });
    return (await documentos.criarVersao(cliente, d.id, canonico)).id;
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versaoId, exigirModo({ id: 'argumentativa', revisao: 1 }));
  await prepararCapitulo(config, execucao.id, canonico.secoes[0]!.id);
  const slots = await mkdtemp(join(tmpdir(), 'margem-j145m-')); temporarios.push(slots);
  for (let i = 0; i < 3; i += 1) await rodarUm(banco, config, auditoria, slots);
  const modelos = (await banco.query<{ id: string; revisao: number; relacoes: number; dificuldades: number }>(`SELECT id, revisao,
    jsonb_array_length(conteudo->'relacoes') AS relacoes, jsonb_array_length(conteudo->'dificuldades') AS dificuldades FROM modelo_capitulo ORDER BY revisao`)).rows;
  expect(modelos.at(-1)?.revisao).toBe(2);
  await migrar(banco);
  const indexados = (await banco.query<{ modelo_id: string; tipo: string; total: string }>(
    'SELECT modelo_id, tipo, count(*) AS total FROM item_do_modelo GROUP BY 1, 2 ORDER BY 1, 2')).rows;
  // Só as revisões >= 2, cada relação e dificuldade uma vez.
  const r2 = modelos.filter((m) => m.revisao >= 2);
  expect(indexados).toEqual(r2.flatMap((m) => [
    ...(m.dificuldades > 0 ? [{ modelo_id: m.id, tipo: 'dificuldade', total: String(m.dificuldades) }] : []),
    ...(m.relacoes > 0 ? [{ modelo_id: m.id, tipo: 'relacao', total: String(m.relacoes) }] : []),
  ]));
  const relacao = (await banco.query<{ citacao: string; destino_citacao: string | null; chave: string }>(
    `SELECT citacao, destino_citacao, chave FROM item_do_modelo WHERE tipo = 'relacao' AND chave = 'exemplifica'`)).rows;
  expect(relacao).toEqual([{ citacao: 'o cardápio impresso não muda todo dia', destino_citacao: 'Admitamos inicialmente que os preços são rígidos', chave: 'exemplifica' }]);
  // Uma revisão nova (r3) entra pelo gatilho.
  const ID_R3 = idTeste('M', 3);
  const base = await comTransacao(banco, (cliente) => compreensao.revisaoDoCapitulo(cliente, execucao.id, canonico.secoes[0]!.id));
  await banco.query(`INSERT INTO modelo_capitulo (id, execucao_id, secao_id, revisao, estagio, conteudo) VALUES ($4,$1,$2,3,'revisao',$3)`,
    [execucao.id, canonico.secoes[0]!.id, JSON.stringify({ ...base, id: ID_R3, revisao: 3 }), ID_R3]);
  expect(Number((await banco.query<{ n: string }>('SELECT count(*) AS n FROM item_do_modelo WHERE modelo_id = $1', [ID_R3])).rows[0]?.n))
    .toBe((base?.relacoes.length ?? 0) + (base?.dificuldades.length ?? 0));
}));
