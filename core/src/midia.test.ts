import { describe, expect, test } from 'vitest';
import { validarMidia, type MidiaV1 } from '@margem/contratos';
import {
  alinharPalavras, capituloNoInstante, chaveDaPalavra, conferirMidiaNoCanonico, formatarTempo, frasesDasPalavras,
  frasesDoAudio, indiceNoInstante, tokensDosBlocos, type PalavraTranscrita,
} from './midia';

const B1 = '0000000000000000000000B001';
const B2 = '0000000000000000000000B002';

function transcrever(texto: string, passo = 0.3): PalavraTranscrita[] {
  return texto.split(/\s+/u).filter(Boolean).map((p, i) => ({ texto: p, inicio_s: i * passo, fim_s: i * passo + passo * 0.8 }));
}

describe('alinhamento palavra → texto', () => {
  test('casa palavras com tokens e guarda offsets UTF-16 (emoji conta duas unidades)', () => {
    const blocos = [{ id: B1, texto: 'Olá 🧭 mundo, tudo bem?' }];
    const r = alinharPalavras(blocos, transcrever('olá 🧭 Mundo tudo bem'));
    // O emoji não tem letra nem número: não é token nem palavra.
    expect(r.palavras.map((p) => blocos[0]!.texto.slice(p.inicio_utf16, p.fim_utf16))).toEqual(['Olá', 'mundo,', 'tudo', 'bem?']);
    expect(r.palavras[1]!.inicio_utf16).toBe(7); // "Olá " (4) + "🧭" (2) + " " (1)
    expect(r.sem_par).toBe(0);
    expect(r.texto_sem_tempo).toBe(0);
  });

  test('pula palavras inventadas e texto não falado sem desalinhar o resto', () => {
    const blocos = [{ id: B1, texto: 'Título que ninguém falou.' }, { id: B2, texto: 'O governo proibiu as bets ontem.' }];
    const r = alinharPalavras(blocos, transcrever('o governo é proibiu as bets ontem'));
    const textos = r.palavras.map((p) => blocos.find((b) => b.id === p.bloco_id)!.texto.slice(p.inicio_utf16, p.fim_utf16));
    expect(textos).toEqual(['O', 'governo', 'proibiu', 'as', 'bets', 'ontem.']);
    expect(r.sem_par).toBe(1);
    expect(r.texto_sem_tempo).toBe(4);
  });

  test('tempos invertidos ou fora de ordem viram sequência monotônica', () => {
    const r = alinharPalavras([{ id: B1, texto: 'a b c' }], [
      { texto: 'a', inicio_s: 1, fim_s: 0.5 }, { texto: 'b', inicio_s: 0.8, fim_s: 1.2 }, { texto: 'c', inicio_s: 2, fim_s: 2.4 },
    ]);
    expect(r.palavras.map((p) => [p.inicio_s, p.fim_s])).toEqual([[1, 1], [1, 1.2], [2, 2.4]]);
  });

  test('chave ignora pontuação e caixa, mas não acentos', () => {
    expect(chaveDaPalavra('“Eleição,”')).toBe('eleição');
    expect(chaveDaPalavra('eleicao')).not.toBe(chaveDaPalavra('eleição'));
    expect(tokensDosBlocos([{ id: B1, texto: '— R$ 174 bi —' }]).map((t) => t.chave)).toEqual(['r', '174', 'bi']);
  });
});

describe('frases e instante', () => {
  const blocos = [{ id: B1, texto: 'Primeira frase aqui. Segunda frase?' }, { id: B2, texto: 'Outro bloco sem ponto' }];
  const { palavras } = alinharPalavras(blocos, transcrever('primeira frase aqui segunda frase outro bloco sem ponto', 0.5));
  const frases = frasesDasPalavras(blocos, palavras);

  test('quebra na pontuação e na troca de bloco', () => {
    expect(frases.map((f) => blocos.find((b) => b.id === f.bloco_id)!.texto.slice(f.inicio_utf16, f.fim_utf16)))
      .toEqual(['Primeira frase aqui.', 'Segunda frase?', 'Outro bloco sem ponto']);
    expect(frases[1]!.inicio_s).toBe(palavras[3]!.inicio_s);
  });

  test('pausa longa quebra a frase', () => {
    const longe = palavras.map((p, i) => i >= 1 ? { ...p, inicio_s: p.inicio_s + 10, fim_s: p.fim_s + 10 } : p);
    expect(frasesDasPalavras(blocos, longe)[0]!.fim_utf16).toBe('Primeira'.length);
  });

  test('busca binária: palavra acesa enquanto dura, frase até a próxima', () => {
    const t = [{ inicio_s: 0, fim_s: 1 }, { inicio_s: 2, fim_s: 3 }, { inicio_s: 3, fim_s: 4 }];
    expect(indiceNoInstante(t, -1)).toEqual({ atual: -1, ultima: -1 });
    expect(indiceNoInstante(t, 0.5)).toEqual({ atual: 0, ultima: 0 });
    expect(indiceNoInstante(t, 1.1)).toEqual({ atual: 0, ultima: 0 });
    expect(indiceNoInstante(t, 1.6)).toEqual({ atual: -1, ultima: 0 });
    expect(indiceNoInstante(t, 3)).toEqual({ atual: 2, ultima: 2 });
    expect(indiceNoInstante(t, 99)).toEqual({ atual: -1, ultima: 2 });
  });

  test('o resultado forma uma MidiaV1 válida e coerente com o canônico', () => {
    const midia: MidiaV1 = {
      versao: 1, id: '0000000000000000000000M001', documento_id: '0000000000000000000000D001', versao_id: '0000000000000000000000V001',
      tipo: 'video', titulo: 'Teste', sha256: 'a'.repeat(64), mime: 'video/mp4', bytes: 10, duracao_s: 6, largura: 640, altura: 360,
      fonte: null, transcricao: { motor: 'teste', idioma: 'pt', sha256: 'b'.repeat(64) }, capitulos: [], palavras, frases,
    };
    expect(validarMidia(midia), JSON.stringify(validarMidia.errors)).toBe(true);
    expect(conferirMidiaNoCanonico(midia, midia.versao_id, { blocos: blocos.map((b, ordem) => ({ ...b, ordem, tipo: 'paragrafo', inline: [], origens: [] })) })).toBe(true);
    const quebrada = { ...midia, palavras: [{ ...palavras[0]!, fim_utf16: 999 }] };
    expect(conferirMidiaNoCanonico(quebrada, midia.versao_id, { blocos: blocos.map((b, ordem) => ({ ...b, ordem, tipo: 'paragrafo', inline: [], origens: [] })) })).toBe(false);
  });

  test('offset no meio de um par substituto é recusado', () => {
    const texto = 'a🧭b';
    const midia = { versao_id: 'V', palavras: [{ bloco_id: B1, inicio_utf16: 0, fim_utf16: 2, inicio_s: 0, fim_s: 1 }], frases: [] };
    expect(conferirMidiaNoCanonico(midia, 'V', { blocos: [{ id: B1, ordem: 0, tipo: 'paragrafo', texto, inline: [], origens: [] }] })).toBe(false);
  });
});

test('capítulos, tempo e áudio narrado', () => {
  expect(capituloNoInstante([{ inicio_s: 0 }, { inicio_s: 60 }], 59.7)).toBe(1);
  expect(capituloNoInstante([{ inicio_s: 10 }], 5)).toBe(-1);
  expect(formatarTempo(3725.9)).toBe('1:02:05');
  expect(formatarTempo(65)).toBe('1:05');
  expect(formatarTempo(Number.NaN)).toBe('0:00');
  const frases = frasesDoAudio({ trechos: [{ inicio_s: 0, fim_s: 2, ancora: { versao_id: 'V', bloco_id: B1, inicio_utf16: 0, fim_utf16: 4, citacao: 'Olá.', prefixo: '', sufixo: '' } }] });
  expect(frases).toEqual([{ bloco_id: B1, inicio_utf16: 0, fim_utf16: 4, inicio_s: 0, fim_s: 2 }]);
});
