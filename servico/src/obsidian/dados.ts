/**
 * Leitura do banco para a exportação ao Obsidian. Só leitura: monta a `EntradaDaExportacao` de um
 * documento (a versão mais recente) e o índice de todos. Quem escreve Markdown é `exportar.ts`.
 */
import { createHash } from 'node:crypto';
import type {
  ConexaoV2, ConversaV2, DocumentoDoIndiceObsidianV1, Id, IndiceObsidianV1, MarcasDaExportacao, MarcaV2,
} from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import { secoesComTitulosApresentados } from '../sumario/conferencia.js';
import * as anotacoesRepo from '../repos/anotacoes.js';
import * as camadasRepo from '../repos/camadas.js';
import * as conexoesRepo from '../repos/conexoes.js';
import * as conversasRepo from '../repos/conversas.js';
import { obterVersao } from '../repos/documentos.js';
import * as etiquetasRepo from '../repos/etiquetas.js';
import * as marcasRepo from '../repos/marcas.js';
import { modosDeLeitura } from '../modos.js';
import { chaveDaFuncao, exportarParaObsidian, type EntradaDaExportacao, type NotaDoObsidian } from './exportar.js';

export interface OpcoesDaExportacao {
  marcas: MarcasDaExportacao;
  url_base: string;
}

export interface LinhaDoDocumento {
  id: Id;
  titulo: string;
  autor: string | null;
  formato: string;
  criado_em: string;
  fonte_url: string | null;
  versao_id: Id | null;
}

export const SQL_DOCUMENTO = `SELECT d.id, d.titulo, d.autor, d.formato,
    to_char(d.criado_em AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criado_em,
    (SELECT m.conteudo->'fonte'->>'url' FROM midia m WHERE m.documento_id=d.id ORDER BY m.criado_em DESC LIMIT 1) AS fonte_url,
    (SELECT v.id FROM versao_texto v WHERE v.documento_id=d.id ORDER BY v.numero DESC LIMIT 1) AS versao_id
  FROM documento d`;

let rotulosEmCache: Readonly<Record<string, string>> | undefined;
function rotulos(): Readonly<Record<string, string>> {
  if (rotulosEmCache) return rotulosEmCache;
  const mapa: Record<string, string> = {};
  for (const modo of modosDeLeitura()) for (const funcao of modo.funcoes) mapa[chaveDaFuncao(modo, funcao.chave)] = funcao.rotulo;
  rotulosEmCache = Object.freeze(mapa);
  return rotulosEmCache;
}

/**
 * As marcas que entram: os grifos do leitor; as da IA que ele confirmou, mudou, etiquetou ou
 * comentou (nota ou pergunta ligada à marca); e, com `todas`, também as visíveis e não rejeitadas
 * da camada que o leitor abre por padrão.
 */
export function escolherMarcas(marcas: readonly MarcaV2[], doLeitor: ReadonlySet<Id>, tocadas: ReadonlySet<Id>,
  camadaPadrao: Id | null, escolha: MarcasDaExportacao): MarcaV2[] {
  return marcas.filter((marca) => {
    if (doLeitor.has(marca.camada_id)) return true;
    if (marca.avaliacao === 'rejeitada') return false;
    if (marca.avaliacao === 'confirmada' || tocadas.has(marca.id)) return true;
    return escolha === 'todas' && marca.visivel && marca.camada_id === camadaPadrao;
  });
}

async function entradaDaLinha(cliente: Transacao, linha: LinhaDoDocumento & { versao_id: Id }, opcoes: OpcoesDaExportacao): Promise<EntradaDaExportacao> {
  const versao = await obterVersao(cliente, linha.versao_id);
  const blocos = versao.canonico.blocos.map((bloco) => bloco.id);
  const camadas = await camadasRepo.listar(cliente, versao.id);
  const doLeitor = new Set(camadas.filter((camada) => camada.tipo === 'leitor').map((camada) => camada.id));
  const anotacoes = await anotacoesRepo.listarNosBlocos(cliente, versao.id, blocos);
  const idsDasConversas = (await cliente.query<{ id: Id }>(
    'SELECT id FROM conversa WHERE versao_id=$1 ORDER BY criada_em, id', [versao.id])).rows;
  const conversas: ConversaV2[] = [];
  for (const { id } of idsDasConversas) {
    const conversa = await conversasRepo.obter(cliente, id);
    if (conversa) conversas.push(conversa);
  }
  const conexoes: ConexaoV2[] = (await conexoesRepo.listarNosBlocos(cliente, versao.id, blocos))
    .filter((conexao) => conexao.origem.versao_id === versao.id && conexao.estado === 'aceita');
  const etiquetas = await etiquetasRepo.daVersao(cliente, versao.id);
  const edicoes = await marcasRepo.edicoes(cliente, versao.id);
  const tocadas = new Set<Id>([
    ...Object.keys(edicoes),
    ...anotacoes.flatMap((nota) => (nota.marca_id === undefined ? [] : [nota.marca_id])),
    ...conversas.flatMap((conversa) => (conversa.marca_id === undefined ? [] : [conversa.marca_id])),
    ...etiquetas.filter((etiqueta) => etiqueta.alvo.tipo === 'marca').map((etiqueta) => etiqueta.alvo.id),
  ]);
  const marcas = escolherMarcas(await marcasRepo.listarV2PorVersao(cliente, versao.id), doLeitor, tocadas,
    await camadasRepo.camadaPadrao(cliente, versao.id), opcoes.marcas);

  // Títulos dos documentos de destino das conexões, para os wikilinks.
  const versoesDeDestino = [...new Set(conexoes.flatMap((conexao) => (conexao.destino.tipo === 'trecho' ? [conexao.destino.ancora.versao_id] : [])))];
  const documentosDeDestino = [...new Set(conexoes.flatMap((conexao) => (conexao.destino.tipo === 'documento' ? [conexao.destino.documento_id] : [])))];
  const destinos: Record<Id, { documento_id: Id; titulo: string }> = {};
  if (versoesDeDestino.length > 0 || documentosDeDestino.length > 0) {
    const linhas = (await cliente.query<{ chave: Id; documento_id: Id; titulo: string }>(
      `SELECT v.id AS chave, d.id AS documento_id, d.titulo FROM versao_texto v JOIN documento d ON d.id=v.documento_id WHERE v.id = ANY($1::text[])
       UNION ALL SELECT d.id AS chave, d.id AS documento_id, d.titulo FROM documento d WHERE d.id = ANY($2::text[])`,
      [versoesDeDestino, documentosDeDestino])).rows;
    for (const destino of linhas) destinos[destino.chave] = { documento_id: destino.documento_id, titulo: destino.titulo };
  }

  return {
    documento: {
      id: linha.id, titulo: linha.titulo, autor: linha.autor, formato: linha.formato,
      criado_em: linha.criado_em, fonte_url: linha.fonte_url,
    },
    versao_id: versao.id,
    // R3-8: os títulos do sumário sugerido em uso, nas mesmas seções do canônico.
    secoes: await secoesComTitulosApresentados(cliente, versao.id, versao.canonico.secoes),
    blocos: versao.canonico.blocos,
    marcas, anotacoes, conversas, conexoes, etiquetas,
    rotulos: rotulos(),
    destinos,
    url_base: opcoes.url_base,
  };
}

export type ResultadoDoDocumento =
  | { estado: 'ok'; nota: NotaDoObsidian; versao_id: Id; sha256: string }
  | { estado: 'inexistente' }
  | { estado: 'sem_texto' };

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export async function notaDoDocumento(cliente: Transacao, documentoId: Id, opcoes: OpcoesDaExportacao): Promise<ResultadoDoDocumento> {
  const linha = (await cliente.query<LinhaDoDocumento>(`${SQL_DOCUMENTO} WHERE d.id=$1`, [documentoId])).rows[0];
  if (!linha) return { estado: 'inexistente' };
  if (linha.versao_id === null) return { estado: 'sem_texto' };
  const nota = exportarParaObsidian(await entradaDaLinha(cliente, { ...linha, versao_id: linha.versao_id }, opcoes));
  return { estado: 'ok', nota, versao_id: linha.versao_id, sha256: sha256(nota.conteudo) };
}

export interface ExportacaoCompleta {
  indice: IndiceObsidianV1;
  notas: Map<Id, NotaDoObsidian>;
}

/**
 * Todos os documentos da biblioteca (sem os arquivados) com texto. Sem `todos`, só os que têm algo
 * do leitor ou escolhido por ele: uma nota vazia por livro não ajuda o vault. Dois títulos que dão o
 * mesmo arquivo: o documento mais antigo fica com o nome, o outro ganha o fim do id.
 */
export async function exportarTudo(cliente: Transacao, opcoes: OpcoesDaExportacao & { todos: boolean }): Promise<ExportacaoCompleta> {
  const linhas = (await cliente.query<LinhaDoDocumento>(
    `${SQL_DOCUMENTO} WHERE d.arquivado_em IS NULL ORDER BY d.criado_em, d.id`)).rows;
  const documentos: DocumentoDoIndiceObsidianV1[] = [];
  const notas = new Map<Id, NotaDoObsidian>();
  const usados = new Set<string>();
  for (const linha of linhas) {
    if (linha.versao_id === null) continue;
    const nota = exportarParaObsidian(await entradaDaLinha(cliente, { ...linha, versao_id: linha.versao_id }, opcoes));
    if (nota.itens === 0 && !opcoes.todos) continue;
    let arquivo = nota.arquivo;
    if (usados.has(arquivo.toLowerCase())) arquivo = `${arquivo.slice(0, -3)} (${linha.id.slice(-6)}).md`;
    usados.add(arquivo.toLowerCase());
    const final = { ...nota, arquivo };
    notas.set(linha.id, final);
    documentos.push({
      documento_id: linha.id, versao_id: linha.versao_id, titulo: linha.titulo, arquivo,
      sha256: sha256(final.conteudo), itens: final.itens, atualizado_em: final.atualizado_em,
    });
  }
  return { indice: { versao: 1, url_base: opcoes.url_base, marcas: opcoes.marcas, documentos }, notas };
}
