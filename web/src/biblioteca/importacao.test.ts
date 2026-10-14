import { expect, test, vi } from 'vitest';
import { ErroDaApi } from './api';
import {
  classificarLink, documentoExistente, emparelharTranscricoes, lerTranscricao, motivoDaFalha, recusaLocal,
  textoDaTranscricao, tipoDoArquivo, tituloDoTexto, LIMITE_DOCUMENTO_BYTES,
  abaDoTipo, abaDosArquivos, imagensColadas, normalizarImagem,
} from './importacao';

const arquivo = (nome: string, type = '') => new File(['x'], nome, { type });

test('detecta o formato pela extensão e, sem ela, pelo MIME', () => {
  expect(['a.pdf', 'b.EPUB', 'c.markdown', 'd.md', 'e.txt', 'f.mp4', 'g.webm', 'h.mp3', 'i.m4a', 'j.json', 'k.docx'].map((nome) => tipoDoArquivo(arquivo(nome))))
    .toEqual(['pdf', 'epub', 'md', 'md', 'txt', 'video', 'video', 'audio', 'audio', 'transcricao', 'desconhecido']);
  expect(tipoDoArquivo(arquivo('sem-extensao', 'application/pdf'))).toBe('pdf');
  expect(tipoDoArquivo(arquivo('gravacao', 'audio/ogg'))).toBe('audio');
});

test('recusa local: formato desconhecido, vazio e acima do limite do serviço', () => {
  expect(recusaLocal(arquivo('planilha.xlsx'))).toMatch(/Formato não aceito/);
  expect(recusaLocal(new File([], 'vazio.txt'))).toBe('O arquivo está vazio.');
  expect(recusaLocal({ name: 'grande.pdf', type: 'application/pdf', size: LIMITE_DOCUMENTO_BYTES + 1 })).toMatch(/200 MB/);
  expect(recusaLocal(arquivo('ok.pdf'))).toBeNull();
});

test('emparelha cada mídia com a sua transcrição pelo nome, ou a única com a única', () => {
  const aula = arquivo('aula.mp4'), entrevista = arquivo('entrevista.mp3');
  const jsonAula = arquivo('aula.transcricao.json'), jsonEntrevista = arquivo('entrevista.json'), solto = arquivo('outro.json');
  const { pares, sobras } = emparelharTranscricoes([aula, entrevista], [jsonEntrevista, solto, jsonAula]);
  expect(pares.get(aula)).toBe(jsonAula);
  expect(pares.get(entrevista)).toBe(jsonEntrevista);
  expect(sobras).toEqual([solto]);
  expect(emparelharTranscricoes([aula], [solto]).pares.get(aula)).toBe(solto);
});

test('confere a transcrição como o importador de linha de comando', () => {
  const valida = { versao: 1, motor: 'whisper', capitulos: [], paragrafos: ['Olá mundo.', 'Fim.'], palavras: [
    { texto: 'Olá', inicio_s: 0, fim_s: 0.4 }, { texto: 'mundo.', inicio_s: 0.4, fim_s: 1 }, { texto: 'Fim.', inicio_s: 2, fim_s: 2.5 },
  ] };
  expect(lerTranscricao(valida).paragrafos).toHaveLength(2);
  expect(textoDaTranscricao(valida)).toBe('Olá mundo.\n\nFim.\n');
  expect(() => lerTranscricao({ ...valida, versao: 2 })).toThrow(/formato do Margem/);
  expect(() => lerTranscricao({ ...valida, palavras: valida.palavras.slice(1) })).toThrow(/não batem/);
  expect(() => lerTranscricao({ ...valida, palavras: [valida.palavras[1], valida.palavras[0], valida.palavras[2]].map((p, i) => ({ ...p, texto: valida.palavras[i]!.texto })) })).toThrow(/Tempo inválido/);
});

test('links: YouTube vai para o serviço, outras páginas para a extensão', () => {
  expect(classificarLink('https://www.youtube.com/watch?v=abc')).toEqual({ tipo: 'youtube', url: 'https://www.youtube.com/watch?v=abc' });
  expect(classificarLink('youtu.be/abc').tipo).toBe('youtube');
  expect(classificarLink('https://m.youtube.com/watch?v=abc').tipo).toBe('youtube');
  expect(classificarLink('https://exemplo.com/artigo').tipo).toBe('pagina');
  expect(classificarLink('notyoutube.com/x').tipo).toBe('pagina');
  expect(classificarLink('não é link').tipo).toBe('invalido');
  expect(classificarLink('ftp://exemplo.com').tipo).toBe('invalido');
});

test('duplicados: o id vem de documento_id ou de existente (rota do YouTube)', () => {
  expect(documentoExistente(new ErroDaApi(409, 'documento_duplicado', 'x', { documento_id: 'A' }))).toBe('A');
  expect(documentoExistente(new ErroDaApi(409, 'duplicado', 'x', { existente: 'B' }))).toBe('B');
  expect(documentoExistente(new ErroDaApi(409, 'duplicado', 'x', { existente: { documento_id: 'C' } }))).toBe('C');
  expect(documentoExistente(new ErroDaApi(400, 'x', 'x', { documento_id: 'A' }))).toBeUndefined();
  expect(motivoDaFalha(new ErroDaApi(413, 'Payload Too Large'))).toBe('Grande demais para esta instalação.');
  expect(motivoDaFalha(new ErroDaApi(400, 'formato_nao_suportado', 'Formatos aceitos: pdf.'))).toBe('Formatos aceitos: pdf.');
});

test('título do texto colado: a primeira linha, sem marcação de título', () => {
  expect(tituloDoTexto('\n# Capítulo um\n\nCorpo')).toBe('Capítulo um');
  expect(tituloDoTexto('   ')).toBe('Texto colado');
  expect(tituloDoTexto('a'.repeat(120))).toHaveLength(80);
});

// ------------------------------------------------------------------ imagens e abas (V-D2)

const PNG_1X1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

test('imagens: PNG, JPEG, WebP e HEIC são imagem; GIF não; cada tipo tem a sua aba', () => {
  expect(['print.png', 'foto.JPG', 'foto.jpeg', 'tela.webp', 'IMG_1.HEIC', 'x.heif', 'anim.gif'].map((nome) => tipoDoArquivo(arquivo(nome))))
    .toEqual(['imagem', 'imagem', 'imagem', 'imagem', 'imagem', 'imagem', 'desconhecido']);
  expect(tipoDoArquivo(arquivo('', 'image/png'))).toBe('imagem');
  expect(tipoDoArquivo(arquivo('sem-nome', 'image/gif'))).toBe('desconhecido');
  expect(recusaLocal(arquivo('print.png', 'image/png'))).toBeNull();
  expect(['pdf', 'epub', 'md', 'txt', 'colado'].map((tipo) => abaDoTipo(tipo as 'pdf'))).toEqual(Array(5).fill('documento'));
  expect(['video', 'audio', 'transcricao', 'youtube'].map((tipo) => abaDoTipo(tipo as 'video'))).toEqual(Array(4).fill('video'));
  expect(abaDoTipo('imagem')).toBe('quadro');
  expect(abaDoTipo('desconhecido')).toBeNull();
  // Lote solto fora de Adicionar: havendo documento, Documento; só mídia, Vídeo; só imagem, Quadro.
  expect(abaDosArquivos([arquivo('a.pdf'), arquivo('b.mp4')])).toBe('documento');
  expect(abaDosArquivos([arquivo('b.mp4'), arquivo('b.json')])).toBe('video');
  expect(abaDosArquivos([arquivo('degas.jpg')])).toBe('quadro');
  expect(abaDosArquivos([arquivo('x.gif')])).toBe('documento');
});

test('colar: só as imagens da área de transferência, e o print sem nome ganha um', () => {
  const print = new File([PNG_1X1], 'image.png', { type: 'image/png' });
  const texto = new File(['oi'], 'nota.txt', { type: 'text/plain' });
  const coladas = imagensColadas({ files: [print, texto], items: [] } as unknown as DataTransfer);
  expect(coladas.map((f) => [f.name, f.type])).toEqual([['print.png', 'image/png']]);
  const pelosItens = imagensColadas({ files: [], items: [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => new File([PNG_1X1], '', { type: 'image/jpeg' }) }] } as unknown as DataTransfer);
  expect(pelosItens.map((f) => f.name)).toEqual(['print.jpg']);
  expect(imagensColadas(null)).toEqual([]);
});

test('normalizar: PNG e JPEG passam como estão; WebP vira PNG no canvas; HEIC ilegível explica', async () => {
  const png = new File([PNG_1X1], 'print.png', { type: 'image/png' });
  expect(await normalizarImagem(png)).toBe(png);
  const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], 'foto.jpg', { type: 'image/jpeg' });
  expect(await normalizarImagem(jpeg)).toBe(jpeg);

  const fechar = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ width: 640, height: 200, close: fechar })));
  const desenhar = vi.fn();
  const contexto = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: desenhar } as unknown as CanvasRenderingContext2D);
  const paraBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, pronto: BlobCallback) {
    expect([this.width, this.height]).toEqual([640, 200]);
    pronto(new Blob([PNG_1X1], { type: 'image/png' }));
  });
  try {
    const webp = new File([new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')], 'tela.webp', { type: 'image/webp' });
    const convertida = await normalizarImagem(webp);
    expect([convertida.name, convertida.type]).toEqual(['tela.png', 'image/png']);
    expect(desenhar).toHaveBeenCalledTimes(1);
    expect(fechar).toHaveBeenCalled();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('não sei'))));
    await expect(normalizarImagem(new File([new Uint8Array(12)], 'IMG_1.HEIC', { type: 'image/heic' }))).rejects.toThrow(/não abre HEIC/);
  } finally {
    contexto.mockRestore(); paraBlob.mockRestore(); vi.unstubAllGlobals();
  }
});
