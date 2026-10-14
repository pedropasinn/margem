/**
 * Conferência dos candidatos que o Codex propôs para uma obra enviada (V-T2).
 *
 * O Codex olha a imagem e diz até três candidatos (título, artista, ano, confiança, pistas). Nenhum é
 * aceito só pela palavra do modelo: cada um é procurado no Wikidata (título e artista) e, sem item, no
 * Wikimedia Commons; a reprodução de lá é baixada e comparada com a imagem enviada pelo pHash
 * (`semelhanca.ts`). Perto: confirmado. Na dúvida: o Codex compara as duas imagens. Longe: descartado.
 * Item do Wikidata sem imagem vale pela confiança do modelo (como antes do V-T2). Nada confirmado: a
 * obra segue só pela imagem, com o primeiro candidato como palpite (V-W5).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecucaoAdiada, ExecucaoFalhou } from '../executor/tipos.js';
import { distanciaEntreArquivos, LIMIAR_MESMA_OBRA, LIMIAR_OBRA_DIFERENTE } from './semelhanca.js';
import { acharArquivoNoCommons, acharItemDaObraComImagem, AGENTE, miniaturaDoCommons, type Buscar } from './v2/dossie-auto.js';

export type Confianca = 'alta' | 'media' | 'baixa';

/** Um candidato do Codex para a obra. */
export interface Candidato { titulo: string; titulo_original: string | null; artista: string; ano: string | null; confianca: Confianca; pistas: string }

/** Como o candidato foi confirmado. */
export type MetodoDaConfirmacao = 'imagem' | 'codex' | 'catalogo' | 'acervo';

/** A obra confirmada: o candidato e onde ele está no catálogo (o dossiê parte daqui). */
export interface ObraConfirmada {
  candidato: Candidato;
  qid: string | null;
  arquivo_commons: string | null;
  metodo: MetodoDaConfirmacao;
  /** Distância perceptual para a reprodução do Commons (0..64), quando houve comparação. */
  distancia: number | null;
}

/** O que aconteceu com cada candidato, para o registro e a auditoria. */
export interface TentativaDeConfirmacao {
  candidato: string;
  qid: string | null;
  arquivo_commons: string | null;
  distancia: number | null;
  /** Veredito do Codex olhando as duas imagens, quando foi chamado. */
  comparacao: boolean | null;
  resultado: 'confirmado' | 'imagem_diferente' | 'sem_catalogo' | 'sem_imagem' | 'confianca_baixa';
}

/** Baixa bytes de uma URL (a miniatura do Commons). */
export type Baixar = (url: string) => Promise<Uint8Array>;
/** O Codex compara a imagem enviada com a reprodução: `true`/`false`, ou a falha/adiamento da chamada. */
export type CompararImagens = (enviada: string, referencia: string, candidato: Candidato) => Promise<boolean | ExecucaoFalhou | ExecucaoAdiada>;

const TETO_DA_MINIATURA = 8 * 1024 * 1024;
/** As miniaturas vêm de `upload.wikimedia.org` ou, desde 2026, de `thumb.wikimedia.org`. */
const hostDeImagem = (host: string): boolean => host === 'wikimedia.org' || host.endsWith('.wikimedia.org');

/** GET da miniatura do Commons (só hosts da Wikimedia, até 8 MB). */
export const baixarNaRede: Baixar = async (url) => {
  const endereco = new URL(url);
  if (endereco.protocol !== 'https:' || !hostDeImagem(endereco.hostname)) throw new Error(`host_nao_permitido: ${endereco.hostname}`);
  const r = await fetch(endereco, { headers: { 'User-Agent': AGENTE, Accept: 'image/*' } });
  if (!r.ok) throw new Error(`rede_${String(r.status)}: ${url}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > TETO_DA_MINIATURA) throw new Error('miniatura_grande_demais');
  return bytes;
};

export interface OpcoesDaConfirmacao {
  buscar: Buscar;
  baixar: Baixar;
  comparar?: CompararImagens;
  /** Para testes: a distância entre dois arquivos (padrão: pHash com ffmpeg). */
  distancia?: (enviada: string, referencia: string) => Promise<number>;
}

export interface ResultadoDaConfirmacao { confirmada: ObraConfirmada | null; tentativas: TentativaDeConfirmacao[] }

const titulosDe = (c: Candidato): string[] => [...new Set([c.titulo_original, c.titulo].filter((t): t is string => typeof t === 'string' && t.trim() !== ''))];

/**
 * Confere os candidatos na ordem e devolve o primeiro confirmado. A rede (Wikidata, Commons) que falha
 * propaga o erro (o preparo mostra "sem conexão" e tenta de novo); a miniatura que não baixa conta como
 * "sem imagem". Uma comparação do Codex adiada (cota) ou que falha é devolvida como está.
 */
export async function confirmarCandidatos(candidatos: readonly Candidato[], imagemEnviada: string, opcoes: OpcoesDaConfirmacao): Promise<ResultadoDaConfirmacao | ExecucaoFalhou | ExecucaoAdiada> {
  const tentativas: TentativaDeConfirmacao[] = [];
  const medir = opcoes.distancia ?? distanciaEntreArquivos;
  const temporario = await mkdtemp(join(tmpdir(), 'margem-quadro-conf-'));
  try {
    for (const [indice, candidato] of candidatos.entries()) {
      const nome = `«${candidato.titulo}», de ${candidato.artista}`;
      let qid: string | null = null;
      let arquivo: string | null = null;
      let miniatura: string | null = null;
      for (const titulo of titulosDe(candidato)) {
        const item = await acharItemDaObraComImagem({ titulo, artista: candidato.artista, ano: candidato.ano }, opcoes.buscar);
        if (item) { qid = item.qid; arquivo = item.arquivo_commons; break; }
      }
      if (arquivo === null) {
        for (const titulo of titulosDe(candidato)) {
          const achado = await acharArquivoNoCommons({ titulo, artista: candidato.artista, ano: candidato.ano }, opcoes.buscar);
          if (achado) { arquivo = achado.arquivo; miniatura = achado.miniatura; break; }
        }
      } else miniatura = await miniaturaDoCommons(arquivo, opcoes.buscar);
      const tentativa: TentativaDeConfirmacao = { candidato: nome, qid, arquivo_commons: arquivo, distancia: null, comparacao: null, resultado: 'sem_catalogo' };
      tentativas.push(tentativa);
      if (qid === null && arquivo === null) continue;

      // A reprodução do catálogo: pHash; na dúvida, o Codex olha as duas.
      let referencia: string | null = null;
      if (miniatura) {
        try {
          referencia = join(temporario, `referencia-${String(indice)}.jpg`);
          await writeFile(referencia, await opcoes.baixar(miniatura));
          tentativa.distancia = await medir(imagemEnviada, referencia);
        } catch { referencia = null; tentativa.distancia = null; }
      }
      if (referencia !== null && tentativa.distancia !== null) {
        let mesma = tentativa.distancia <= LIMIAR_MESMA_OBRA;
        let metodo: MetodoDaConfirmacao = 'imagem';
        if (!mesma && tentativa.distancia <= LIMIAR_OBRA_DIFERENTE && opcoes.comparar) {
          const veredito = await opcoes.comparar(imagemEnviada, referencia, candidato);
          if (typeof veredito !== 'boolean') return veredito;
          tentativa.comparacao = veredito;
          mesma = veredito;
          metodo = 'codex';
        }
        if (!mesma) { tentativa.resultado = 'imagem_diferente'; continue; }
        tentativa.resultado = 'confirmado';
        return { confirmada: { candidato, qid, arquivo_commons: arquivo, metodo, distancia: tentativa.distancia }, tentativas };
      }
      // Sem reprodução para comparar: o achado no catálogo vale se o modelo não estava só chutando.
      if (candidato.confianca !== 'baixa') {
        tentativa.resultado = 'confirmado';
        return { confirmada: { candidato, qid, arquivo_commons: arquivo, metodo: 'catalogo', distancia: null }, tentativas };
      }
      tentativa.resultado = miniatura === null ? 'sem_imagem' : 'confianca_baixa';
    }
    return { confirmada: null, tentativas };
  } finally {
    await rm(temporario, { recursive: true, force: true });
  }
}
