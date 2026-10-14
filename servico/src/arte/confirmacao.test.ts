/**
 * V-T2: conferência dos candidatos do Codex no Wikidata e no Commons. Regras com a distância encenada;
 * e o caso real do teste de 14/10: a cópia em WebP de "Educação Obrigatória" contra a reprodução do Commons
 * (a imagem da obra de exemplo), com a rede de fixture copiada das respostas reais.
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { ARQUIVO_DA_EDUCACAO, MINIATURA_DA_EDUCACAO, REDE_DA_EDUCACAO, redeDeFixture } from '../../testes/quadros.js';
import { falhou } from '../executor/tipos.js';
import { confirmarCandidatos, type Candidato } from './confirmacao.js';

const raiz = (relativo: string) => new URL(`../../../${relativo}`, import.meta.url).pathname;
const educacao: Candidato = { titulo: 'Educação Obrigatória', titulo_original: 'Compulsory Education', artista: 'Briton Rivière', ano: '1887', confianca: 'baixa', pistas: 'Menina de branco com faixa azul, livro e um cão de caça.' };
const leiteira: Candidato = { titulo: 'A Leiteira', titulo_original: 'Het melkmeisje', artista: 'Johannes Vermeer', ano: 'c. 1658', confianca: 'alta', pistas: 'Criada despejando leite.' };
const baixarFixture = (arquivo: string) => async () => new Uint8Array(await readFile(arquivo));
const semBaixar = () => Promise.reject(new Error('sem rede'));

describe('regras, com a distância encenada', () => {
  test('perto confirma pela imagem; longe descarta sem perguntar ao Codex; no meio, o Codex decide', async () => {
    const comparar = vi.fn(() => Promise.resolve(true));
    const opcoes = (distancia: number) => ({ buscar: redeDeFixture([], REDE_DA_EDUCACAO), baixar: baixarFixture(raiz('web/public/arte/educacao.jpg')), comparar, distancia: () => Promise.resolve(distancia) });
    expect(await confirmarCandidatos([educacao], '/x.jpg', opcoes(4))).toMatchObject({ confirmada: { metodo: 'imagem', qid: null, arquivo_commons: ARQUIVO_DA_EDUCACAO, distancia: 4 } });
    expect(await confirmarCandidatos([educacao], '/x.jpg', opcoes(30))).toMatchObject({ confirmada: null, tentativas: [{ resultado: 'imagem_diferente', comparacao: null, distancia: 30 }] });
    expect(comparar).not.toHaveBeenCalled();
    expect(await confirmarCandidatos([educacao], '/x.jpg', opcoes(16))).toMatchObject({ confirmada: { metodo: 'codex' }, tentativas: [{ resultado: 'confirmado', comparacao: true }] });
    expect(comparar).toHaveBeenCalledTimes(1);
    // Sem o comparador (Codex desligado), a dúvida descarta.
    expect(await confirmarCandidatos([educacao], '/x.jpg', { ...opcoes(16), comparar: undefined })).toMatchObject({ confirmada: null });
  });

  test('a comparação adiada pela cota volta como está (o preparo espera na fila)', async () => {
    const adiada = { estado: 'adiado' as const, codigo: 'cota' as const, mensagem: 'cota', duracao_ms: 1, not_before: new Date('2026-10-15T10:00:00Z') };
    const r = await confirmarCandidatos([educacao], '/x.jpg', { buscar: redeDeFixture([], REDE_DA_EDUCACAO), baixar: baixarFixture(raiz('web/public/arte/educacao.jpg')), comparar: () => Promise.resolve(adiada), distancia: () => Promise.resolve(16) });
    expect(r).toEqual(adiada);
    const falha = falhou('processo', 'A CLI terminou com código 1.', 5);
    expect(await confirmarCandidatos([educacao], '/x.jpg', { buscar: redeDeFixture([], REDE_DA_EDUCACAO), baixar: baixarFixture(raiz('web/public/arte/educacao.jpg')), comparar: () => Promise.resolve(falha), distancia: () => Promise.resolve(16) })).toEqual(falha);
  });

  test('sem reprodução para comparar: o catálogo vale com confiança média ou alta; com confiança baixa, não', async () => {
    // A Leiteira do Wikidata de fixture não tem P18: confirma pelo catálogo (como antes do V-T2).
    expect(await confirmarCandidatos([leiteira], '/x.jpg', { buscar: redeDeFixture(), baixar: semBaixar })).toMatchObject({ confirmada: { metodo: 'catalogo', qid: 'Q100', arquivo_commons: null } });
    expect(await confirmarCandidatos([{ ...leiteira, confianca: 'baixa' }], '/x.jpg', { buscar: redeDeFixture(), baixar: semBaixar })).toMatchObject({ confirmada: null, tentativas: [{ resultado: 'sem_imagem', qid: 'Q100' }] });
    // O Commons acha o arquivo, mas a miniatura não baixa: palpite de confiança baixa não passa.
    expect(await confirmarCandidatos([educacao], '/x.jpg', { buscar: redeDeFixture([], REDE_DA_EDUCACAO), baixar: semBaixar })).toMatchObject({ confirmada: null, tentativas: [{ resultado: 'confianca_baixa', arquivo_commons: ARQUIVO_DA_EDUCACAO }] });
  });

  test('candidato fora do catálogo é pulado e o próximo é conferido; nenhum candidato, nada confirmado; rede fora do ar propaga', async () => {
    const inventado: Candidato = { titulo: 'Menina e Cão', titulo_original: null, artista: 'Pintor Inventado', ano: null, confianca: 'media', pistas: 'palpite' };
    const urls: string[] = [];
    const r = await confirmarCandidatos([inventado, educacao], '/x.jpg', { buscar: redeDeFixture(urls, REDE_DA_EDUCACAO), baixar: baixarFixture(raiz('web/public/arte/educacao.jpg')), distancia: () => Promise.resolve(3) });
    expect(r).toMatchObject({ confirmada: { candidato: { titulo: 'Educação Obrigatória' } }, tentativas: [{ resultado: 'sem_catalogo' }, { resultado: 'confirmado' }] });
    // Os dois títulos do candidato são tentados no Wikidata (o original primeiro) antes do Commons.
    expect(urls.filter((u) => u.includes('srsearch=') && u.includes('www.wikidata.org')).map((u) => decodeURIComponent(u.split('srsearch=')[1]!))).toEqual(['Menina e Cão Pintor Inventado', 'Compulsory Education Briton Rivière', 'Educação Obrigatória Briton Rivière']);
    expect(await confirmarCandidatos([], '/x.jpg', { buscar: redeDeFixture(), baixar: semBaixar })).toEqual({ confirmada: null, tentativas: [] });
    await expect(confirmarCandidatos([educacao], '/x.jpg', { buscar: () => Promise.reject(new Error('ENOTFOUND')), baixar: semBaixar })).rejects.toThrow('ENOTFOUND');
  });
});

const comFfmpeg = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libwebp') === true;

test.skipIf(!comFfmpeg)('o caso real: a cópia em WebP confirma "Compulsory Education" pela reprodução do Commons; "O Bobo que Ri" não', async () => {
  const enviada = raiz('fixtures/arte/variacoes/educacao-enviada.webp');
  const baixados: string[] = [];
  const baixar = async (url: string) => { baixados.push(url); return new Uint8Array(await readFile(raiz('web/public/arte/educacao.jpg'))); };
  const r = await confirmarCandidatos([educacao], enviada, { buscar: redeDeFixture([], REDE_DA_EDUCACAO), baixar });
  expect(r).toMatchObject({ confirmada: { metodo: 'imagem', arquivo_commons: ARQUIVO_DA_EDUCACAO, qid: null } });
  expect(baixados).toEqual([MINIATURA_DA_EDUCACAO]);
  // A reprodução de outra obra, mesmo com título e artista batendo no catálogo, é descartada pela imagem.
  const outra = await confirmarCandidatos([educacao], enviada, { buscar: redeDeFixture([], REDE_DA_EDUCACAO), baixar: baixarFixture(raiz('web/public/arte/tolo.jpg')) });
  expect(outra).toMatchObject({ confirmada: null, tentativas: [{ resultado: 'imagem_diferente' }] });
});
