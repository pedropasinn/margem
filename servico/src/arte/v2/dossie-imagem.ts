/**
 * Dossiê de uma obra não identificada (V-W5): quando o Codex não reconhece a obra pela imagem e a pessoa
 * não informou título e artista, o preparo não para. A análise segue só pela imagem: a única fonte é a
 * imagem enviada (`imagem_enviada`, endereço `margem:quadros/<slug>/imagem.jpg`), a identidade fica
 * "Obra não identificada" sem afirmação nenhuma, e o modelo só pode observar (com região) e inferir (com
 * apoio). O palpite do Codex entra no dossiê como apoio, nunca como fonte citável.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FonteDaObra, ModeloDaObraV1 } from '@margem/contratos';
import type { DossieDaObra, ObraDoAcervo } from './acervo.js';
import { idDeFonte } from './dossie-auto.js';

export const TITULO_NAO_IDENTIFICADO = 'Obra não identificada';
export const ARTISTA_NAO_IDENTIFICADO = 'Artista não identificado';
export const LIMITE_SO_IMAGEM = 'Obra não identificada: análise só pela imagem, sem fontes históricas. Tudo aqui é o que se vê ou o que se infere do que se vê; informe o título e o artista para uma análise com fontes.';

/** O endereço da imagem enviada como fonte (o contrato aceita só este formato fora de https). */
export const urlDaImagemEnviada = (slug: string): string => `margem:quadros/${slug}/imagem.jpg`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? v as Json : {});
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * O dossiê que vai ao Codex e o modelo-base que a montagem completa, sem rede e sem identificação.
 * `palpite` é o que o Codex disse ao não reconhecer a obra (ex.: "lembra cenas sentimentais britânicas
 * do fim do século XIX"); vai como apoio, para virar no máximo uma inferência.
 */
export async function dossieEBaseSoPelaImagem(obra: ObraDoAcervo, palpite: string | null, hoje = new Date().toISOString().slice(0, 10)): Promise<{ dossie: DossieDaObra; base: ModeloDaObraV1 }> {
  const imagem = obj(JSON.parse(await readFile(join(obra.pasta, 'imagem.json'), 'utf8')));
  const largura = imagem.largura, altura = imagem.altura;
  if (typeof largura !== 'number' || typeof altura !== 'number') throw new Error(`imagem_json_sem_dimensoes: ${obra.slug}`);
  const fonte: FonteDaObra = {
    id: idDeFonte(`imagem/${obra.slug}`), titulo: 'A imagem enviada', url: urlDaImagemEnviada(obra.slug), categoria: 'imagem_enviada', consultado_em: hoje,
  };
  const desconhecida = 'não identificada';
  const base: ModeloDaObraV1 = {
    versao: 1, id: idDeFonte(`base/${obra.slug}`), revisao: 1,
    identidade: { titulo: TITULO_NAO_IDENTIFICADO, titulo_original: TITULO_NAO_IDENTIFICADO, artista: ARTISTA_NAO_IDENTIFICADO, data: `Data ${desconhecida}`, tecnica: `Técnica ${desconhecida}`, afirmacoes: [] },
    imagem: { url: `/arte/${obra.slug}.jpg`, largura, altura, sha256: obra.sha256, credito: texto(imagem.credito) || 'Imagem enviada por você', fonte_id: fonte.id },
    localizacao: { instituicao_proprietaria: null, localizacao_conhecida: null, atualmente_exposto: null, sala: null, verificado_em: hoje, fontes: [] },
    fontes: [fonte], regioes: [], afirmacoes: [], estudo: [], limites: [LIMITE_SO_IMAGEM],
  };
  const dossie: DossieDaObra = {
    identidade: { titulo: TITULO_NAO_IDENTIFICADO, titulo_original: TITULO_NAO_IDENTIFICADO, artista: ARTISTA_NAO_IDENTIFICADO, data: '', tecnica: '', afirmacao: '', fontes: [] },
    localizacao: { instituicao_proprietaria: null, localizacao_conhecida: null },
    fontes: [{ id: fonte.id, titulo: fonte.titulo, url: fonte.url, categoria: fonte.categoria, texto: null, arquivo: null }],
    pesquisa: [],
    apoio: palpite ? [{ arquivo: 'palpite-de-identificacao', texto: `Palpite de quem olhou a imagem, sem confirmação (não é fonte): ${palpite}` }] : [],
  };
  return { dossie, base };
}
