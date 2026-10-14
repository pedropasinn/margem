/**
 * Leitura do banco para a exportação ao Obsidian no formato 2 (uma nota por item). Só leitura: monta
 * a `EntradaDaExportacaoV2` de um documento (a versão mais recente), decide o nome da pasta de cada
 * documento e gera o índice V2 de todos. Quem escreve Markdown é `exportar-v2.ts`.
 *
 * As marcas que entram são as mesmas da V1 (`escolherMarcas`), contando também como "tocadas" as que têm
 * um sinal de dificuldade. As anotações vêm sem as fundidas pela migração 0032 (o repositório filtra). As conexões são as aceitas com a origem
 * ou o destino na versão, já em V3 (com o tipo fino da relação, quando houver).
 */
import type {
  AncoraV1, ConversaV2, Id, IndiceObsidianV2, MarcasDaExportacao, TipoDeNotaDoObsidian,
} from '@margem/contratos';
import { TIPOS_DE_NOTA_DO_OBSIDIAN } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { listarCartoes } from '../flashcards/repo.js';
import { modosDeLeitura } from '../modos.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import * as camadasRepo from '../repos/camadas.js';
import * as conexoesRepo from '../repos/conexoes.js';
import * as conversasRepo from '../repos/conversas.js';
import * as dificuldadesRepo from '../repos/dificuldades.js';
import { obterVersao } from '../repos/documentos.js';
import * as etiquetasRepo from '../repos/etiquetas.js';
import * as marcasRepo from '../repos/marcas.js';
import * as resolucoesRepo from '../repos/resolucoes.js';
import { SQL_DOCUMENTO, escolherMarcas, sha256, type LinhaDoDocumento } from './dados.js';
import { chaveDaFuncao, nomeDoArquivo } from './exportar.js';
import {
  exportarParaObsidianV2, type EntradaDaExportacaoV2, type ExportacaoDoDocumentoV2, type FuncaoDaExportacao, type MarcaExterna,
} from './exportar-v2.js';

export interface OpcoesDaExportacaoV2 {
  marcas: MarcasDaExportacao;
  url_base: string;
  /** Tipos de nota exportados; a nota-índice sempre vai. */
  incluir: readonly TipoDeNotaDoObsidian[];
}

export const INCLUIR_TUDO: readonly TipoDeNotaDoObsidian[] = TIPOS_DE_NOTA_DO_OBSIDIAN;

let funcoesEmCache: Readonly<Record<string, FuncaoDaExportacao>> | undefined;
function funcoes(): Readonly<Record<string, FuncaoDaExportacao>> {
  if (funcoesEmCache) return funcoesEmCache;
  const mapa: Record<string, FuncaoDaExportacao> = {};
  for (const modo of modosDeLeitura()) {
    for (const funcao of modo.funcoes) mapa[chaveDaFuncao(modo, funcao.chave)] = { rotulo: funcao.rotulo, cor: funcao.cor.claro };
  }
  funcoesEmCache = Object.freeze(mapa);
  return funcoesEmCache;
}

const mesmaFaixa = (a: AncoraV1, b: AncoraV1): boolean =>
  a.versao_id === b.versao_id && a.bloco_id === b.bloco_id && a.inicio_utf16 === b.inicio_utf16 && a.fim_utf16 === b.fim_utf16;

/**
 * Nome da pasta (e da nota-índice) de cada documento com texto e não arquivado: o título limpo, como
 * na V1; dois títulos que dão o mesmo nome, o mais antigo fica com ele e o outro ganha o fim do id.
 */
export async function nomesDosDocumentos(cliente: Transacao): Promise<Map<Id, string>> {
  const linhas = (await cliente.query<{ id: Id; titulo: string }>(`SELECT d.id, d.titulo FROM documento d
    WHERE d.arquivado_em IS NULL AND EXISTS (SELECT 1 FROM versao_texto v WHERE v.documento_id=d.id)
    ORDER BY d.criado_em, d.id`)).rows;
  const nomes = new Map<Id, string>();
  const usados = new Set<string>();
  for (const linha of linhas) {
    let nome = nomeDoArquivo(linha.titulo, linha.id).slice(0, -3);
    if (usados.has(nome.toLowerCase())) nome = `${nome} (${linha.id.slice(-6)})`;
    usados.add(nome.toLowerCase());
    nomes.set(linha.id, nome);
  }
  return nomes;
}

async function entradaV2DaLinha(cliente: Transacao, linha: LinhaDoDocumento & { versao_id: Id }, opcoes: OpcoesDaExportacaoV2,
  nome: string | undefined): Promise<EntradaDaExportacaoV2> {
  const incluir = new Set(opcoes.incluir);
  const versao = await obterVersao(cliente, linha.versao_id);
  const blocos = versao.canonico.blocos.map((bloco) => bloco.id);
  const camadas = await camadasRepo.listar(cliente, versao.id);
  const doLeitor = new Set(camadas.filter((camada) => camada.tipo === 'leitor').map((camada) => camada.id));
  const anotacoes = await anotacoesRepo.listarNosBlocos(cliente, versao.id, blocos);
  const idsDasConversas = (await cliente.query<{ id: Id }>('SELECT id FROM conversa WHERE versao_id=$1 ORDER BY criada_em, id', [versao.id])).rows;
  const conversas: ConversaV2[] = [];
  for (const { id } of idsDasConversas) {
    const conversa = await conversasRepo.obter(cliente, id);
    if (conversa) conversas.push(conversa);
  }
  const conexoes = (await conexoesRepo.listarV3NosBlocos(cliente, versao.id, blocos)).filter((conexao) => conexao.estado === 'aceita');
  const etiquetas = await etiquetasRepo.daVersao(cliente, versao.id);
  // Modelo D: os sinais de dificuldade (os descartados não saem); o grifo de um sinal entra como "tocado".
  const dificuldades = (await dificuldadesRepo.listarDaVersao(cliente, versao.id)).filter((d) => d.estado !== 'descartada');
  const edicoes = await marcasRepo.edicoes(cliente, versao.id);
  const tocadas = new Set<Id>([
    ...Object.keys(edicoes),
    ...anotacoes.flatMap((nota) => (nota.marca_id === undefined ? [] : [nota.marca_id])),
    ...conversas.flatMap((conversa) => (conversa.marca_id === undefined ? [] : [conversa.marca_id])),
    ...etiquetas.filter((etiqueta) => etiqueta.alvo.tipo === 'marca').map((etiqueta) => etiqueta.alvo.id),
    ...dificuldades.flatMap((d) => (d.marca_id === undefined ? [] : [d.marca_id])),
  ]);
  const marcas = escolherMarcas(await marcasRepo.listarV2PorVersao(cliente, versao.id), doLeitor, tocadas,
    await camadasRepo.camadaPadrao(cliente, versao.id), opcoes.marcas);

  // As pontas de relação fora desta versão: títulos dos documentos e marcas com a mesma faixa.
  const pontasDeFora: AncoraV1[] = conexoes.flatMap((conexao) => [conexao.origem, ...(conexao.destino.tipo === 'trecho' ? [conexao.destino.ancora] : [])])
    .filter((ancora) => ancora.versao_id !== versao.id);
  const versoesDeFora = [...new Set(pontasDeFora.map((ancora) => ancora.versao_id))].sort();
  const documentosDeFora = [...new Set(conexoes.flatMap((conexao) => (conexao.destino.tipo === 'documento' ? [conexao.destino.documento_id] : [])))].sort();
  const destinos: Record<Id, { documento_id: Id; titulo: string }> = {};
  if (versoesDeFora.length > 0 || documentosDeFora.length > 0) {
    const linhas = (await cliente.query<{ chave: Id; documento_id: Id; titulo: string }>(
      `SELECT v.id AS chave, d.id AS documento_id, d.titulo FROM versao_texto v JOIN documento d ON d.id=v.documento_id WHERE v.id = ANY($1::text[])
       UNION ALL SELECT d.id AS chave, d.id AS documento_id, d.titulo FROM documento d WHERE d.id = ANY($2::text[])`,
      [versoesDeFora, documentosDeFora])).rows;
    for (const destino of linhas) destinos[destino.chave] = { documento_id: destino.documento_id, titulo: destino.titulo };
  }
  // A marca da outra ponta ganha link quando a exportação do outro documento também a leva: grifo do
  // leitor ou marca confirmada (as regras de lá, sem as "tocadas", que dependem do resto daquele documento).
  const marcas_externas: MarcaExterna[] = [];
  for (const outra of versoesDeFora) {
    const camadasDeLa = new Set((await camadasRepo.listar(cliente, outra)).filter((camada) => camada.tipo === 'leitor').map((camada) => camada.id));
    for (const marca of await marcasRepo.listarV2PorVersao(cliente, outra)) {
      if (!pontasDeFora.some((ancora) => mesmaFaixa(ancora, marca.ancora))) continue;
      if (!camadasDeLa.has(marca.camada_id) && marca.avaliacao !== 'confirmada') continue;
      marcas_externas.push({ id: marca.id, ancora: marca.ancora, funcao: marca.funcao, modo: marca.modo });
    }
  }

  const flashcards = incluir.has('flashcard')
    ? (await listarCartoes(cliente, { documento_id: linha.id })).filter((cartao) => cartao.versao_id === versao.id)
      .map(({ id, ancora, frente, verso, origem, criado_em, atualizado_em }) => ({ id, ancora, frente, verso, origem, criado_em, atualizado_em }))
    : [];
  const resolucoes = incluir.has('exercicio')
    ? (await resolucoesRepo.todasDoDocumento(cliente, linha.id)).filter((resolucao) => resolucao.versao_id === versao.id)
    : [];

  return {
    documento: {
      id: linha.id, titulo: linha.titulo, autor: linha.autor, formato: linha.formato, criado_em: linha.criado_em, fonte_url: linha.fonte_url,
    },
    versao_id: versao.id,
    secoes: versao.canonico.secoes,
    blocos: versao.canonico.blocos,
    marcas: incluir.has('grifo') ? marcas : [],
    anotacoes: incluir.has('anotacao') ? anotacoes : [],
    conversas: incluir.has('pergunta') ? conversas : [],
    conexoes: incluir.has('relacao') ? conexoes : [],
    etiquetas, dificuldades, flashcards, resolucoes,
    funcoes: funcoes(), destinos, marcas_externas,
    url_base: opcoes.url_base,
    ...(nome === undefined ? {} : { nome }),
  };
}

export type ResultadoDoDocumentoV2 =
  | { estado: 'ok'; exportacao: ExportacaoDoDocumentoV2; versao_id: Id }
  | { estado: 'inexistente' }
  | { estado: 'sem_texto' };

export async function documentoV2(cliente: Transacao, documentoId: Id, opcoes: OpcoesDaExportacaoV2): Promise<ResultadoDoDocumentoV2> {
  const linha = (await cliente.query<LinhaDoDocumento>(`${SQL_DOCUMENTO} WHERE d.id=$1`, [documentoId])).rows[0];
  if (!linha) return { estado: 'inexistente' };
  if (linha.versao_id === null) return { estado: 'sem_texto' };
  const nome = (await nomesDosDocumentos(cliente)).get(documentoId);
  const exportacao = exportarParaObsidianV2(await entradaV2DaLinha(cliente, { ...linha, versao_id: linha.versao_id }, opcoes, nome));
  return { estado: 'ok', exportacao, versao_id: linha.versao_id };
}

export interface ExportacaoCompletaV2 {
  indice: IndiceObsidianV2;
  documentos: Map<Id, ExportacaoDoDocumentoV2>;
}

/** O índice V2 a partir das exportações já geradas (a ordem é a delas: documento a documento). */
export function indiceV2(documentos: Iterable<ExportacaoDoDocumentoV2>, opcoes: OpcoesDaExportacaoV2): IndiceObsidianV2 {
  const incluir = TIPOS_DE_NOTA_DO_OBSIDIAN.filter((tipo) => tipo === 'documento' || opcoes.incluir.includes(tipo));
  return {
    versao: 2, url_base: opcoes.url_base, marcas: opcoes.marcas, incluir,
    notas: [...documentos].flatMap((exportacao) => exportacao.notas.map((nota) => ({
      id: nota.id, tipo: nota.tipo, documento_id: nota.documento_id, caminho: nota.caminho, sha256: sha256(nota.conteudo), atualizado_em: nota.atualizado_em,
    }))),
  };
}

/**
 * Todos os documentos (sem os arquivados) com texto. Sem `todos`, só os que têm algo do leitor ou
 * escolhido por ele, como na V1. `apenas` restringe a um documento (o ZIP de um documento só).
 */
export async function exportarTudoV2(cliente: Transacao, opcoes: OpcoesDaExportacaoV2 & { todos: boolean; apenas?: Id }): Promise<ExportacaoCompletaV2> {
  const linhas = (await cliente.query<LinhaDoDocumento>(
    `${SQL_DOCUMENTO} WHERE d.arquivado_em IS NULL ${opcoes.apenas === undefined ? '' : 'AND d.id=$1'} ORDER BY d.criado_em, d.id`,
    opcoes.apenas === undefined ? [] : [opcoes.apenas])).rows;
  const nomes = await nomesDosDocumentos(cliente);
  const documentos = new Map<Id, ExportacaoDoDocumentoV2>();
  for (const linha of linhas) {
    if (linha.versao_id === null) continue;
    const entrada = await entradaV2DaLinha(cliente, { ...linha, versao_id: linha.versao_id }, opcoes, nomes.get(linha.id));
    const exportacao = exportarParaObsidianV2(entrada);
    if (exportacao.notas.length === 1 && entrada.dificuldades.length === 0 && !opcoes.todos && opcoes.apenas === undefined) continue;
    documentos.set(linha.id, exportacao);
  }
  return { indice: indiceV2(documentos.values(), opcoes), documentos };
}
