/** Imagens de fontes convertidas, separadas do texto canônico imutável. */
import { readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { dentroDaRaiz, ehUlid, pastaDaVersao } from '../dados.js';
import { arquivoNosDados } from '../geometria/arquivos.js';

interface Ilustracao {
  bloco_id: string;
  arquivo: string;
  alt: string;
  posicao: 'antes' | 'depois';
  largura?: number;
  altura?: number;
}
const NOME = /^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif|svg)$/;

export async function lerIlustracoes(documentoId: string, versaoId: string): Promise<Ilustracao[]> {
  const caminho = await arquivoNosDados(join(pastaDaVersao(documentoId, versaoId), 'ilustracoes.json'));
  if (!caminho) return [];
  const dados: unknown = JSON.parse(await readFile(caminho, 'utf8'));
  if (!dados || typeof dados !== 'object' || !('versao_id' in dados) || dados.versao_id !== versaoId ||
      !('figuras' in dados) || !Array.isArray(dados.figuras) ||
      Object.keys(dados).some((chave) => !['versao_id', 'figuras'].includes(chave))) throw new Error('Manifesto de ilustrações inválido.');
  return dados.figuras.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('bloco_id' in item) || typeof item.bloco_id !== 'string' || !ehUlid(item.bloco_id) ||
        !('arquivo' in item) || typeof item.arquivo !== 'string' || !NOME.test(item.arquivo) ||
        !('alt' in item) || typeof item.alt !== 'string' ||
        !('posicao' in item) || (item.posicao !== 'antes' && item.posicao !== 'depois') ||
        ('largura' in item && (typeof item.largura !== 'number' || !Number.isInteger(item.largura) || item.largura <= 0)) ||
        ('altura' in item && (typeof item.altura !== 'number' || !Number.isInteger(item.altura) || item.altura <= 0)) ||
        Object.keys(item).some((chave) => !['bloco_id', 'arquivo', 'alt', 'posicao', 'largura', 'altura'].includes(chave))) throw new Error('Ilustração inválida.');
    return { bloco_id: item.bloco_id, arquivo: item.arquivo, alt: item.alt, posicao: item.posicao,
      ...('largura' in item && typeof item.largura === 'number' ? { largura: item.largura } : {}),
      ...('altura' in item && typeof item.altura === 'number' ? { altura: item.altura } : {}),
    };
  });
}

export async function arquivoDaIlustracao(documentoId: string, versaoId: string, nome: string): Promise<string | null> {
  if (!NOME.test(nome)) return null;
  const figuras = await lerIlustracoes(documentoId, versaoId);
  if (!figuras.some((figura) => figura.arquivo === nome)) return null;
  const pasta = pastaDaVersao(documentoId, versaoId);
  const caminho = await arquivoNosDados(join(pasta, 'ilustracoes', nome));
  if (!caminho) return null;
  const base = await realpath(pasta);
  return dentroDaRaiz(base, relative(base, caminho)) ? caminho : null;
}
