import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import dados from '../../../tests/fixtures/j18.json';
import type { SnapshotCapitulo } from '../tipos';
import { EstudoDoCapitulo } from '../EstudoDoCapitulo';
import { OuvirDaqui } from './OuvirDaqui';
import { escolherVoz, fraseDoPonto, frasesDoCapitulo, palavraEm } from './voz';

const B1 = '0000000000000000000000B001';
const B2 = '0000000000000000000000B002';
const B3 = '0000000000000000000000B003';
const blocos = [
  { id: B1, ordem: 0, tipo: 'paragrafo', texto: 'Primeira frase. Segunda frase aqui.', inline: [], origens: [] },
  { id: B2, ordem: 1, tipo: 'figura', texto: 'Figura 1', inline: [], origens: [] },
  { id: B3, ordem: 2, tipo: 'paragrafo', texto: 'Terceira frase.', inline: [], origens: [] },
] as unknown as SnapshotCapitulo['blocos'];

// ------------------------------------------------------------ speechSynthesis simulado
class FalaFalsa {
  lang = ''; rate = 1; voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: { name: string; charIndex: number; charLength?: number }) => void) | null = null;
  constructor(readonly text: string) {}
}
const voz = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice => ({ name, lang, default: false, localService: true, voiceURI: name, ...extra });
let faladas: FalaFalsa[];
let vozes: SpeechSynthesisVoice[];
let sintese: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => SpeechSynthesisVoice[]; addEventListener: () => void; removeEventListener: () => void };
beforeEach(() => {
  faladas = [];
  vozes = [voz('English', 'en-US', { default: true }), voz('eSpeak Portuguese', 'pt-BR'), voz('Google português do Brasil', 'pt-BR'), voz('Joana', 'pt-PT')];
  sintese = { speak: vi.fn((f: FalaFalsa) => { faladas.push(f); }), cancel: vi.fn(), getVoices: () => vozes, addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal('speechSynthesis', sintese);
  vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa);
  window.scrollBy = vi.fn();
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 200, 100, 20);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect; });
const ultima = (): FalaFalsa => faladas[faladas.length - 1]!;

test('frases do capítulo pulam figura; o ponto escolhe a frase que o contém', () => {
  const frases = frasesDoCapitulo(blocos);
  expect(frases.map((f) => f.texto)).toEqual(['Primeira frase.', 'Segunda frase aqui.', 'Terceira frase.']);
  expect(fraseDoPonto(frases, blocos, { bloco_id: B1, offset_utf16: 20 })).toBe(1);
  expect(fraseDoPonto(frases, blocos, { bloco_id: B2, offset_utf16: 0 })).toBe(2);
  expect(fraseDoPonto(frases, blocos, null)).toBe(0);
  expect(palavraEm('Segunda frase aqui.', 8)).toEqual({ inicio: 8, fim: 13 });
});

test('a melhor voz pt-BR vence; sem português, nenhuma', () => {
  expect(escolherVoz(vozes)?.name).toBe('Google português do Brasil');
  expect(escolherVoz([voz('Joana', 'pt-PT'), voz('English', 'en-US')])?.name).toBe('Joana');
  expect(escolherVoz([voz('English', 'en-US')])).toBeNull();
});

test('lê a partir do ponto, frase a frase, com play, pausa, velocidade e parar', () => {
  const aoSair = vi.fn();
  render(<OuvirDaqui blocos={blocos} raiz={null} inicio={{ bloco_id: B1, offset_utf16: 20 }} aoSair={aoSair} />);
  expect(ultima().text).toBe('Segunda frase aqui.');
  expect(ultima().voice?.name).toBe('Google português do Brasil');
  expect(ultima().lang).toBe('pt-BR');
  expect(screen.getByText(/Frase 2 de 3/)).toBeTruthy();
  act(() => { ultima().onend?.(); });
  expect(ultima().text).toBe('Terceira frase.');
  // Pausar cala; tocar retoma do começo da frase.
  fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
  expect(sintese.cancel).toHaveBeenCalled();
  const antes = faladas.length;
  act(() => { faladas[antes - 1]!.onend?.(); }); // evento atrasado da fala cancelada: ignorado
  expect(faladas.length).toBe(antes);
  fireEvent.click(screen.getByRole('button', { name: 'Tocar' }));
  expect(ultima().text).toBe('Terceira frase.');
  fireEvent.click(screen.getByRole('button', { name: 'Velocidade' }));
  expect(ultima().rate).toBe(1.25);
  expect(localStorage.getItem('margem:voz-do-sistema:velocidade')).toBe('1.25');
  act(() => { ultima().onend?.(); });
  expect(screen.getByText('Fim do capítulo.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
  expect(aoSair).toHaveBeenCalled();
});

test('destaca a frase e, com o evento boundary, a palavra no texto', async () => {
  const raiz = document.createElement('div');
  raiz.innerHTML = `<article class="capitulo"><p data-bloco="${B1}"><span data-inicio="0">${blocos[0]!.texto}</span></p></article>`;
  document.body.append(raiz);
  const registro = new Map<string, { intervalos: Range[] }>();
  vi.stubGlobal('CSS', { highlights: registro });
  vi.stubGlobal('Highlight', class { priority = 0; readonly intervalos: Range[]; constructor(...i: Range[]) { this.intervalos = i; } });
  render(<OuvirDaqui blocos={blocos} raiz={raiz} inicio={{ bloco_id: B1, offset_utf16: 20 }} aoSair={() => undefined} />);
  act(() => { ultima().onboundary?.({ name: 'word', charIndex: 8 }); });
  await waitFor(() => expect(registro.get('margem-karaoke-palavra')?.intervalos[0]?.toString()).toBe('frase'));
});

test('sem voz em português, avisa', () => {
  vozes = [voz('English', 'en-US')];
  vi.useFakeTimers();
  render(<OuvirDaqui blocos={blocos} raiz={null} inicio={null} aoSair={() => undefined} />);
  expect(screen.getByText(/sem voz em português neste aparelho/)).toBeTruthy();
  expect(ultima().lang).toBe('pt-BR');
  vi.useRealTimers();
});

test('no leitor: sem áudio preparado, o Ouvir oferece "Ouvir a partir daqui"', async () => {
  const snapshot = dados.snapshot as SnapshotCapitulo;
  const documento = dados.snapshot.documento_id;
  const buscar = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/midias') ? { midias: [] } : url.endsWith('/audios') ? { audios: [] } : url.endsWith('/visuais') ? { visuais: [] } : {}))));
  vi.stubGlobal('fetch', buscar);
  render(<EstudoDoCapitulo documento_id={documento} snapshot={snapshot} aoAtualizar={async () => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir' }));
  fireEvent.click(await screen.findByRole('button', { name: /Ouvir a partir daqui/ }));
  expect(screen.getByRole('region', { name: 'Ouvir com a voz do sistema' })).toBeTruthy();
  expect(faladas.length).toBe(1);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Ouvir com a voz do sistema' })).toBeNull();
});

test('no leitor: com áudio preparado, o Ouvir continua só com o player atual', async () => {
  const snapshot = dados.snapshot as SnapshotCapitulo;
  const documento = dados.snapshot.documento_id;
  const bloco = snapshot.blocos[0]!;
  const midia = {
    versao: 1, id: '0000000000000000000000M001', documento_id: documento, versao_id: snapshot.versao_id, tipo: 'audio', titulo: 'Narração',
    sha256: 'a'.repeat(64), mime: 'audio/mpeg', bytes: 10, duracao_s: 10, largura: null, altura: null, fonte: null,
    transcricao: { motor: 'teste', idioma: 'pt', sha256: 'b'.repeat(64) }, capitulos: [{ inicio_s: 0, titulo: 'Abertura' }],
    palavras: [{ bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 3, inicio_s: 0, fim_s: 1 }],
    frases: [{ bloco_id: bloco.id, inicio_utf16: 0, fim_utf16: 3, inicio_s: 0, fim_s: 1 }],
  };
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/midias') ? { midias: [midia] } : url.endsWith('/audios') ? { audios: [] } : url.endsWith('/visuais') ? { visuais: [] } : {})))));
  render(<EstudoDoCapitulo documento_id={documento} snapshot={snapshot} aoAtualizar={async () => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvir' }));
  await screen.findByRole('button', { name: /Ouvir a narração/ });
  expect(screen.queryByRole('button', { name: /Ouvir a partir daqui/ })).toBeNull();
});
