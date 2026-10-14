import { describe, expect, test } from 'vitest';
import { MAXIMO_DE_AVISOS, mensagemDosAvisos, resumirAvisos } from './avisos';

describe('avisos de um job concluído', () => {
  test('info fica de fora; códigos conhecidos viram frases; marcas recusadas se agrupam', () => {
    const avisos = resumirAvisos('ler_parte', [
      { nivel: 'info', codigo: 'ancoragem_aproximada', mensagem: 'Marca 1: a | b' },
      { nivel: 'aviso', codigo: 'citacao_ausente', mensagem: 'Marca 2 no bloco 01K…: “x”' },
      { nivel: 'aviso', codigo: 'citacao_ambigua', mensagem: 'Marca 3 no bloco 01K…: “y”' },
      { nivel: 'aviso', codigo: 'leitura_parcial', mensagem: 'blocos 4–9' },
      { nivel: 'aviso', codigo: 'proveniencia_divergente', mensagem: 'modelo x ≠ y' },
    ]);
    expect(avisos).toEqual([
      { codigo: 'leitura_parcial', mensagem: 'O Codex leu só parte deste trecho; pode faltar alguma marca.' },
      { codigo: 'marcas_recusadas', mensagem: '2 marcas ficaram de fora porque não deu para ancorá-las no texto.' },
    ]);
    expect(mensagemDosAvisos(avisos)).toBe('O Codex leu só parte deste trecho; pode faltar alguma marca. (e mais 1 aviso)');
  });

  test('narração aproximada e código desconhecido (texto cortado, código saneado)', () => {
    const longa = 'x'.repeat(400);
    const avisos = resumirAvisos('gerar_flashcards', [
      { nivel: 'aviso', codigo: 'alinhamento_aproximado', mensagem: 'trecho 3' },
      { nivel: 'aviso', codigo: 'Fora-Do-Padrao', mensagem: longa },
    ]);
    expect(avisos[0]).toEqual({ codigo: 'alinhamento_aproximado', mensagem: 'A narração ficou com o tempo aproximado em alguns trechos.' });
    expect(avisos[1]!.codigo).toBe('aviso');
    expect(avisos[1]!.mensagem.length).toBeLessThanOrEqual(200);
  });

  test('sem diagnósticos, nada; nunca mais que o teto', () => {
    expect(resumirAvisos('responder', null)).toEqual([]);
    expect(mensagemDosAvisos([])).toBeNull();
    const muitos = Array.from({ length: 9 }, (_, i) => ({ nivel: 'aviso' as const, codigo: `codigo_${String(i)}`, mensagem: `m${String(i)}` }));
    expect(resumirAvisos('responder', muitos)).toHaveLength(MAXIMO_DE_AVISOS);
  });
});
