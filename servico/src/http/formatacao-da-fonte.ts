/** Tipografia comprovada na fonte HTML, sem reescrever o texto publicado. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bloco } from '@margem/contratos';
import { pastaDaVersao } from '../dados.js';
import { arquivoNosDados } from '../geometria/arquivos.js';
interface FormatoDaFonte {
  marcador?: string;
  inline: { inicio: number; fim: number; estilo: 'sobrescrito' | 'subscrito' }[];
}
export async function formatacaoDaFonte(documentoId: string, versaoId: string, blocos: readonly Bloco[]): Promise<Record<string, FormatoDaFonte>> {
  const caminho = await arquivoNosDados(join(pastaDaVersao(documentoId, versaoId), 'formatacao.json'));
  if (!caminho) return {};
  const dados: unknown = JSON.parse(await readFile(caminho, 'utf8'));
  if (!dados || typeof dados !== 'object' || !('versao_id' in dados) || dados.versao_id !== versaoId ||
      !('blocos' in dados) || !dados.blocos || typeof dados.blocos !== 'object' || Array.isArray(dados.blocos) ||
      Object.keys(dados).some((chave) => !['versao_id', 'blocos'].includes(chave))) throw new Error('Formatação de fonte inválida.');
  const resultado: Record<string, FormatoDaFonte> = {};
  for (const [id, item] of Object.entries(dados.blocos) as [string, unknown][]) {
    const bloco = blocos.find((bloco) => bloco.id === id);
    if (!bloco) continue;
    if (!item || typeof item !== 'object' || !('inline' in item) || !Array.isArray(item.inline) ||
        ('marcador' in item && (typeof item.marcador !== 'string' || !/^\d+\.$/.test(item.marcador) || bloco.tipo !== 'lista')) ||
        Object.keys(item).some((chave) => !['inline', 'marcador'].includes(chave))) throw new Error('Formatação de bloco inválida.');
    const inline: FormatoDaFonte['inline'] = item.inline.map((trecho: unknown) => {
      if (!trecho || typeof trecho !== 'object' || !('inicio' in trecho) || typeof trecho.inicio !== 'number' || !Number.isInteger(trecho.inicio) || trecho.inicio < 0 ||
          !('fim' in trecho) || typeof trecho.fim !== 'number' || !Number.isInteger(trecho.fim) || trecho.fim <= trecho.inicio || trecho.fim > bloco.texto.length ||
          !('estilo' in trecho) || (trecho.estilo !== 'sobrescrito' && trecho.estilo !== 'subscrito') ||
          !('citacao' in trecho) || typeof trecho.citacao !== 'string' || bloco.texto.slice(trecho.inicio, trecho.fim) !== trecho.citacao ||
          Object.keys(trecho).some((chave) => !['inicio', 'fim', 'estilo', 'citacao'].includes(chave))) throw new Error('Âncora de formatação inválida.');
      return { inicio: trecho.inicio, fim: trecho.fim, estilo: trecho.estilo };
    });
    resultado[id] = { inline, ...('marcador' in item && typeof item.marcador === 'string' ? { marcador: item.marcador } : {}) };
  }
  return resultado;
}
