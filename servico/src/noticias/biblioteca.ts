import { gravarTipoDetectado } from '../tipo-de-texto/identificar.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { ulid } from 'ulid';
import type pg from 'pg';
import { hashEstrutural, type CanonicoV1, type EdicaoDeNoticiasV1, type Bloco, type Secao } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import { caminhoDoOriginal, pastaDoDocumento } from '../dados.js';
import * as documentos from '../repos/documentos.js';
import { hash } from './validar.js';
import { registro } from './repositorio.js';

export function textoDaEdicao(e: EdicaoDeNoticiasV1): { blocos: Bloco[]; secoes: Secao[]; original: string } {
  const blocos: Bloco[] = [], secoes: Secao[] = [];
  const adicionar = (texto: string, tipo: Bloco['tipo'] = 'paragrafo') => {
    // Prosa canônica não admite quebras internas; parágrafos têm âncoras próprias.
    const b: Bloco = { id: ulid(), ordem: blocos.length, tipo, texto: texto.replace(/\s+/gu, ' ').trim(), inline: [],
      origens: [{ tipo: 'texto', linha_inicio: blocos.length * 2 + 1, linha_fim: blocos.length * 2 + 1 }] };
    blocos.push(b); return b;
  };
  const secao = (titulo: string, paragrafos: string[]) => {
    const inicio = adicionar(titulo, 'capitulo');
    for (const texto of paragrafos.filter(Boolean)) adicionar(texto);
    secoes.push({ id: ulid(), nivel: 1, ordem: secoes.length, titulo, bloco_inicio: inicio.id, bloco_fim: blocos.at(-1)!.id });
  };
  secao(e.titulo, [e.abertura, `Revista de IA aplicada. Corte: ${e.corte_em}. Síntese editorial gerada por IA e revisada automaticamente contra as fontes.`]);
  for (const n of e.noticias) secao(n.titulo, [n.resumo, n.importancia, `Limite: ${n.limite}`,
    ...n.evidencias.map(f => `Fonte: ${f.fonte_url} — Evidência literal: “${f.citacao}”`)]);
  if (e.roteiro) secao('Roteiro do áudio', [e.roteiro]);
  secao('Cobertura', e.cobertura.map(c => `${c.nome}: ${c.estado}; ${String(c.lidos)} páginas lidas de ${String(c.candidatos)} candidatos no feed. ${c.limite}`));
  return { blocos, secoes, original: blocos.map(b => b.texto).join('\n\n') };
}

export async function guardarNaBiblioteca(banco: pg.Pool, id: string): Promise<string> {
  return comTransacao(banco, async c => {
    await c.query('SELECT id FROM noticia_edicao WHERE id=$1 FOR UPDATE', [id]);
    const edicao = await registro(c, id);
    if (edicao.documento_id) return edicao.documento_id;
    if (!edicao.conteudo) throw new Error('A edição ainda não está disponível.');
    const texto = textoDaEdicao(edicao.conteudo);
    const titulo = `Notícias · ${edicao.dia} · ${edicao.conteudo.titulo}`;
    const metadados = { titulo, autor: 'Margem · Notícias', idioma: 'pt-BR', formato: 'txt' as const, sha256_original: hash(texto.original) };
    const doc = await documentos.criar(c, { ...metadados, origem_caminho: '' });
    const caminho = caminhoDoOriginal(doc.id, 'txt');
    await mkdir(pastaDoDocumento(doc.id), { recursive: true });
    await writeFile(caminho, texto.original, { flag: 'wx', mode: 0o600 });
    await c.query('UPDATE documento SET origem_caminho=$2 WHERE id=$1', [doc.id, caminho]);
    const canonico: CanonicoV1 = { versao: 1, documento: metadados,
      canonizacao: { motor: 'margem-noticias/1', gerado_em: new Date().toISOString() },
      hash_estrutural: hashEstrutural(texto.blocos), blocos: texto.blocos, secoes: texto.secoes,
      assets: [], limites: ['Síntese editorial. As fontes originais são documentos distintos; as evidências estão transcritas com seus links.'] };
    await documentos.criarVersao(c, doc.id, canonico);
    // A edição das Notícias já se sabe notícia: nenhum Codex para reconhecer o tipo.
    await gravarTipoDetectado(c, doc.id, { tipo_id: 'noticia', confianca: 'alta', justificativa: 'Edição das Notícias do Margem.', alternativas: [], job_id: null, em: new Date().toISOString() });
    await c.query('UPDATE noticia_edicao SET documento_id=$2 WHERE id=$1', [id, doc.id]);
    return doc.id;
  });
}
