/** J109 · A parte pura da importação do YouTube: metadados, escolha e leitura da legenda, parágrafos. */
import { describe, expect, test } from 'vitest';
import { LEGENDA_AUTOMATICA, LEGENDA_DO_CANAL } from './youtube.casos';
import { escolherLegenda, metadadosDoYtDlp, paragrafosDasPalavras, paragrafosDoTexto, palavrasDaLegendaJson3, textoSemTranscricao, videoComEstadoDoJob } from './youtube';

describe('metadados do yt-dlp', () => {
  test('interpreta, limita e descarta o que não serve', () => {
    const meta = metadadosDoYtDlp({
      id: 'x', title: '  A jogada\nde mestre  ', channel: 'Fernando Ulrich', upload_date: '20260920', duration: 1224.5, language: 'pt',
      description: 'Linha 1\n\nLinha 2', chapters: [{ start_time: 61, title: 'Segundo' }, { start_time: 0, title: 'Abertura' }, { start_time: -1, title: 'ruim' }, { start_time: 5 }],
      subtitles: { 'pt-BR': [], live_chat: [] }, automatic_captions: { 'pt-orig': [], en: [], '../x': [] },
    }, 'dO8EW2LqBfU');
    expect(meta).toMatchObject({
      id: 'dO8EW2LqBfU', titulo: 'A jogada de mestre', canal: 'Fernando Ulrich', publicado_em: '2026-09-20', duracao_s: 1224.5, idioma: 'pt',
      capitulos: [{ inicio_s: 0, titulo: 'Abertura' }, { inicio_s: 61, titulo: 'Segundo' }], legendas: ['pt-BR'], automaticas: ['pt-orig', 'en'],
    });
    expect(metadadosDoYtDlp(null, 'dO8EW2LqBfU')).toMatchObject({ titulo: null, canal: null, capitulos: [], legendas: [] });
  });
});

describe('escolha da legenda', () => {
  test('a do canal na língua do vídeo, depois pt/en, depois a automática original; nunca tradução automática', () => {
    expect(escolherLegenda({ idioma: 'pt', legendas: ['en', 'pt-BR'], automaticas: ['pt-orig'] })).toEqual({ idioma: 'pt-BR', automatica: false });
    expect(escolherLegenda({ idioma: 'es', legendas: ['en'], automaticas: ['es-orig'] })).toEqual({ idioma: 'en', automatica: false });
    expect(escolherLegenda({ idioma: 'pt', legendas: [], automaticas: ['en', 'pt-orig', 'fr'] })).toEqual({ idioma: 'pt-orig', automatica: true });
    expect(escolherLegenda({ idioma: 'pt', legendas: [], automaticas: ['pt', 'en'] })).toEqual({ idioma: 'pt', automatica: true });
    expect(escolherLegenda({ idioma: null, legendas: [], automaticas: ['en-orig', 'pt'] })).toEqual({ idioma: 'en-orig', automatica: true });
    expect(escolherLegenda({ idioma: null, legendas: [], automaticas: ['pt', 'en'] })).toBeNull();
    expect(escolherLegenda({ idioma: 'pt', legendas: [], automaticas: [] })).toBeNull();
  });
});

describe('legendas json3', () => {
  test('automática: palavra a palavra com o deslocamento, sem quebras nem [Música]', () => {
    const palavras = palavrasDaLegendaJson3(LEGENDA_AUTOMATICA);
    expect(palavras.map((p) => p.texto)).toEqual(['a', 'China', 'fez', 'uma', 'jogada', 'de', 'mestre']);
    expect(palavras[1]).toMatchObject({ inicio_s: 0.4 });
    expect(palavras[4]).toMatchObject({ inicio_s: 3.8, fim_s: 4.2 });
    expect(palavras.at(-1)).toMatchObject({ inicio_s: 4.4, fim_s: 5.2 });
  });
  test('do canal: a fala repartida pelo tamanho das palavras, sem >> nem (risos)', () => {
    const palavras = palavrasDaLegendaJson3(LEGENDA_DO_CANAL);
    expect(palavras.map((p) => p.texto)).toEqual(['A', 'China', 'fez', 'uma', 'jogada.']);
    expect(palavras[0]!.inicio_s).toBeGreaterThanOrEqual(1);
    expect(palavras[2]!.fim_s).toBeCloseTo(3, 3);
    expect(palavras[3]!.inicio_s).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < palavras.length; i++) expect(palavras[i]!.inicio_s).toBeGreaterThanOrEqual(palavras[i - 1]!.inicio_s);
  });
  test('entrada estranha não quebra', () => {
    expect(palavrasDaLegendaJson3(null)).toEqual([]);
    expect(palavrasDaLegendaJson3({ events: [{ segs: [{ utf8: 'sem tempo' }] }, { tStartMs: 0, segs: 'x' }] })).toEqual([]);
  });
});

describe('parágrafos', () => {
  const palavra = (texto: string, s: number) => ({ texto, inicio_s: s, fim_s: s + 0.3 });
  test('fecham em frase inteira, em capítulo novo, em pausa longa e (sem pontuação) no dobro do tamanho', () => {
    const corridas = Array.from({ length: 500 }, (_, i) => palavra(`p${String(i)}`, i * 0.4));
    const grupos = paragrafosDasPalavras(corridas, []);
    expect(grupos.every((g) => g.length <= 220)).toBe(true);
    expect(grupos.flat()).toEqual(corridas.map((_, i) => i));
    const comPausa = [palavra('Um.', 0), palavra('dois', 10), palavra('três.', 10.5)];
    expect(paragrafosDoTexto(comPausa, [])).toEqual(['Um.', 'dois três.']);
    const comCapitulo = [palavra('Abre', 0), palavra('aqui.', 0.5), palavra('Novo', 61), palavra('tema.', 61.5)];
    expect(paragrafosDoTexto(comCapitulo, [{ inicio_s: 0 }, { inicio_s: 61 }])).toEqual(['Abre aqui.', 'Novo tema.']);
    // Um parágrafo não começa com marcador de lista do TXT.
    expect(paragrafosDoTexto([palavra('Fim.', 0), palavra('-', 10), palavra('item', 10.2)], [])).toEqual(['Fim. - item']);
  });
});

test('texto sem transcrição e estado do job que desistiu', () => {
  const texto = textoSemTranscricao({ descricao: 'Primeiro.\n\nSegundo   parágrafo.' }, 'O YouTube não oferece legendas.');
  expect(texto).toBe('Sem transcrição. O YouTube não oferece legendas. O vídeo toca normalmente no player.\n\nDescrição do vídeo no YouTube:\n\nPrimeiro.\n\nSegundo parágrafo.\n');
  const video = { versao: 1 as const, documento_id: 'D', video_id: 'dO8EW2LqBfU', url: 'u', titulo: 't', capitulos: [], transcricao: { estado: 'pendente' as const } };
  expect(videoComEstadoDoJob(video, { estado: 'reservado', error_code: null })).toBe(video);
  expect(videoComEstadoDoJob(video, { estado: 'falhou', error_code: 'tentativas_esgotadas' }).transcricao).toEqual({ estado: 'falhou', detalhe: 'A importação parou: tentativas_esgotadas.' });
});
