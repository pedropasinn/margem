/**
 * Export da biblioteca em Markdown para o agente da página "Perguntar".
 *
 * Uma pasta por versão atual de cada documento (`textos/<versao_id>/`), um arquivo por capítulo
 * (seção de nível 1), e cada bloco numa linha que começa pelo id: `⟦b:<bloco_id>⟧ texto`. As versões
 * são imutáveis, então a pasta é escrita uma vez e reaproveitada entre perguntas; só o índice
 * (`INDICE.md`, títulos, autores e capítulos) é refeito a cada pergunta, porque a biblioteca muda.
 * Escrita em temporário e `rename`: duas perguntas ao mesmo tempo não deixam pasta pela metade.
 *
 * O Codex recebe a pasta montada só para leitura (`anexos` do executor) e a percorre com `grep`,
 * `sed` e `cat`, dentro do sandbox, sem rede.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { renomearComRetentativa } from '../plataforma/disco.js';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Bloco, CanonicoV1, Id, Secao } from '@margem/contratos';
import type { Transacao } from '../db/transacao.js';
import * as documentosRepo from '../repos/documentos.js';
import { blocosDaSecao } from '../visuais/manipuladores.js';

export const VERSAO_DO_EXPORT = 1;
export const ARQUIVO_DO_INDICE = 'INDICE.md';

export interface CapituloExportado { numero: number; titulo: string; secao_id: Id | null; arquivo: string; palavras: number; blocos: number }
export interface DocumentoExportado {
  documento_id: Id; versao_id: Id; titulo: string; autor: string | null; formato: string; capitulos: CapituloExportado[];
}
interface Manifesto { versao: typeof VERSAO_DO_EXPORT; documento: DocumentoExportado }

const palavras = (texto: string): number => texto.match(/\S+/gu)?.length ?? 0;

function slug(texto: string): string {
  const base = texto.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  return base.slice(0, 48).replace(/-$/u, '') || 'capitulo';
}

/** Capítulos na ordem do livro; sem seção de nível 1, o documento inteiro é um capítulo só. */
function capitulosDe(canonico: CanonicoV1): { secao: Secao | null; titulo: string; blocos: Bloco[] }[] {
  const secoes = [...canonico.secoes].sort((a, b) => a.ordem - b.ordem).filter((secao) => secao.nivel === 1);
  if (secoes.length === 0) return [{ secao: null, titulo: canonico.documento.titulo, blocos: [...canonico.blocos] }];
  return secoes.map((secao) => ({ secao, titulo: secao.titulo, blocos: blocosDaSecao(canonico, secao) }));
}

/** Um capítulo em Markdown: cabeçalho com os ids e um bloco por parágrafo, com os subtítulos no lugar. */
export function capituloEmMarkdown(canonico: CanonicoV1, documento: { documento_id: Id; versao_id: Id }, capitulo: { secao: Secao | null; titulo: string; blocos: Bloco[] }, numero: number): string {
  const subtitulos = new Map(canonico.secoes.filter((secao) => secao.nivel > 1).map((secao) => [secao.bloco_inicio, secao]));
  const autor = canonico.documento.autor ? ` — ${canonico.documento.autor}` : '';
  const linhas = [
    `# ${capitulo.titulo}`,
    '',
    `Documento: ${canonico.documento.titulo}${autor} · capítulo ${String(numero)}`,
    `documento_id: ${documento.documento_id} · versao_id: ${documento.versao_id} · secao_id: ${capitulo.secao?.id ?? '(sem capítulo)'}`,
    'Cada bloco começa com ⟦b:<bloco_id>⟧; cite pelo bloco_id e pela versao_id acima.',
    '',
  ];
  for (const bloco of capitulo.blocos) {
    const subtitulo = subtitulos.get(bloco.id);
    if (subtitulo) linhas.push(`${'#'.repeat(Math.min(6, subtitulo.nivel + 1))} ${subtitulo.titulo}`, '');
    if (bloco.texto.trim() === '') continue;
    linhas.push(`⟦b:${bloco.id}⟧ [${bloco.tipo}] ${bloco.texto}`, '');
  }
  return `${linhas.join('\n')}\n`;
}

async function lerManifesto(pasta: string): Promise<DocumentoExportado | null> {
  try {
    const manifesto = JSON.parse(await readFile(join(pasta, 'manifesto.json'), 'utf8')) as Partial<Manifesto>;
    return manifesto.versao === VERSAO_DO_EXPORT && manifesto.documento ? manifesto.documento : null;
  } catch {
    return null;
  }
}

/** Escreve a pasta da versão (se ainda não existe) e devolve o que entrou no índice. */
async function exportarVersao(cliente: Transacao, raiz: string, documento: { id: Id; titulo: string; autor: string | null; formato: string }, versaoId: Id): Promise<{ exportado: DocumentoExportado; novo: boolean }> {
  const pasta = join(raiz, 'textos', versaoId);
  const existente = await lerManifesto(pasta);
  if (existente) return { exportado: { ...existente, titulo: documento.titulo, autor: documento.autor }, novo: false };
  const versao = await documentosRepo.obterVersao(cliente, versaoId);
  const temporaria = join(raiz, 'textos', `.${versaoId}-${ulid()}`);
  await mkdir(temporaria, { recursive: true });
  const capitulos: CapituloExportado[] = [];
  try {
    for (const [indice, capitulo] of capitulosDe(versao.canonico).entries()) {
      const numero = indice + 1;
      const arquivo = `${String(numero).padStart(2, '0')}-${slug(capitulo.titulo)}.md`;
      await writeFile(join(temporaria, arquivo), capituloEmMarkdown(versao.canonico, { documento_id: documento.id, versao_id: versaoId }, capitulo, numero));
      capitulos.push({
        numero, titulo: capitulo.titulo, secao_id: capitulo.secao?.id ?? null, arquivo: `textos/${versaoId}/${arquivo}`,
        palavras: capitulo.blocos.reduce((total, bloco) => total + palavras(bloco.texto), 0), blocos: capitulo.blocos.length,
      });
    }
    const exportado: DocumentoExportado = {
      documento_id: documento.id, versao_id: versaoId, titulo: documento.titulo, autor: documento.autor, formato: documento.formato, capitulos,
    };
    await writeFile(join(temporaria, 'manifesto.json'), `${JSON.stringify({ versao: VERSAO_DO_EXPORT, documento: exportado } satisfies Manifesto, null, 2)}\n`);
    try {
      await renomearComRetentativa(temporaria, pasta);
    } catch {
      // Outra pergunta escreveu a mesma versão antes: vale a dela (o conteúdo é o mesmo).
      await rm(temporaria, { recursive: true, force: true });
    }
    return { exportado, novo: true };
  } catch (erro) {
    await rm(temporaria, { recursive: true, force: true });
    throw erro;
  }
}

export function indiceEmMarkdown(documentos: readonly DocumentoExportado[]): string {
  const linhas = [
    `# Biblioteca do leitor — ${String(documentos.length)} documentos`,
    '',
    'Cada documento tem uma pasta `textos/<versao_id>/` com um arquivo por capítulo. Para achar um assunto:',
    '`grep -rn -i "termo" textos/ | head -50`; para ler um capítulo: `sed -n "1,200p" <arquivo>`.',
    '',
  ];
  for (const documento of documentos) {
    linhas.push(`## ${documento.titulo}${documento.autor ? ` — ${documento.autor}` : ''}`, '');
    linhas.push(`documento_id: ${documento.documento_id} · versao_id: ${documento.versao_id} · formato: ${documento.formato} · ${String(documento.capitulos.length)} capítulo(s)`, '');
    for (const capitulo of documento.capitulos) {
      linhas.push(`- ${String(capitulo.numero)}. ${capitulo.titulo} — \`${capitulo.arquivo}\` · secao_id ${capitulo.secao_id ?? '(nenhuma)'} · ${String(capitulo.palavras)} palavras`);
    }
    linhas.push('');
  }
  return `${linhas.join('\n')}\n`;
}

export interface ExportDaBiblioteca { raiz: string; documentos: DocumentoExportado[]; novos: number }

/** Atualiza o export (pastas novas só para versões novas) e reescreve o índice. */
export async function exportarBiblioteca(cliente: Transacao, raiz: string): Promise<ExportDaBiblioteca> {
  await mkdir(join(raiz, 'textos'), { recursive: true });
  const documentos: DocumentoExportado[] = [];
  let novos = 0;
  for (const documento of await documentosRepo.listar(cliente)) {
    if (documento.ultima_versao_id === null) continue;
    const { exportado, novo } = await exportarVersao(cliente, raiz, documento, documento.ultima_versao_id);
    documentos.push(exportado);
    if (novo) novos += 1;
  }
  const temporario = join(raiz, `.${ARQUIVO_DO_INDICE}-${ulid()}`);
  await writeFile(temporario, indiceEmMarkdown(documentos));
  await renomearComRetentativa(temporario, join(raiz, ARQUIVO_DO_INDICE));
  return { raiz, documentos, novos };
}
