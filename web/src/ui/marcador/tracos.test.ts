import { describe, expect, test } from 'vitest';
import { tracos, type Acao } from './tracos';
const linhas = [{ x: 10, y: 20, largura: 160, altura: 18 }, { x: 10, y: 46, largura: 90, altura: 18 }];
describe('traços puros', () => {
  test('a semente repete o desenho; sementes distintas mudam a mão', () => {
    expect(tracos(linhas, { semente: 'marca-1' })).toEqual(tracos(linhas, { semente: 'marca-1' }));
    expect(tracos(linhas, { semente: 'marca-1' })).not.toEqual(tracos(linhas, { semente: 'marca-2' }));
  });
  test('marca-texto multilinha tem uma faixa chanfrada por linha e iteração', () => {
    expect(tracos(linhas)).toHaveLength(2);
    expect(tracos(linhas, { iteracoes: 3 })).toHaveLength(6);
    expect(tracos(linhas)[0]?.d.match(/L/g)).toHaveLength(5);
    expect(tracos(linhas)[0]?.preenchido).toBe(true);
  });
  test('rugosidade zero produz linha de régua independente da semente', () => {
    const opcoes = { acao: 'riscado' as const, rugosidade: 0, recuo: 0 };
    expect(tracos(linhas, opcoes)[0]?.d).toBe('M10 29 L170 29');
    expect(tracos(linhas, { ...opcoes, semente: 1 })).toEqual(tracos(linhas, { ...opcoes, semente: 2 }));
  });
  test('na régua o marca-texto é uma faixa reta, da mesma proporção em cada linha, sem inclinação nem sorteio', () => {
    const [primeira, segunda] = tracos(linhas, { rugosidade: 0, semente: 'a' });
    expect(tracos(linhas, { rugosidade: 0, semente: 'b' })).toEqual([primeira, segunda]);
    expect(primeira?.d).toBe('M11 21.8 L169 21.8 Q171 21.8 171 23.8 L171 34.92 Q171 36.92 169 36.92 L11 36.92 Q9 36.92 9 34.92 L9 23.8 Q9 21.8 11 21.8 Z');
    expect(segunda?.d).toContain('M11 47.8 L');
  });
  test('grifo: por linha, uma faixa da altura da linha e uma linha firme na borda de baixo', () => {
    const [faixa, base, segunda] = tracos(linhas, { acao: 'grifo', rugosidade: 0, espessura: 2 });
    expect(faixa).toMatchObject({ preenchido: true, d: 'M9 20.72 L171 20.72 L171 37.64 L9 37.64 Z' });
    expect(base).toMatchObject({ preenchido: false, d: 'M9 37.64 L171 37.64', espessura: 1.5 });
    expect(segunda?.preenchido).toBe(true);
    expect(tracos(linhas, { acao: 'grifo', rugosidade: 0 })).toHaveLength(4);
    // À mão: a faixa chanfrada mais um sublinhado irregular.
    expect(tracos(linhas, { acao: 'grifo' }).map((traco) => traco.preenchido)).toEqual([true, true, false, false]);
  });
  test('na régua o sublinhado fica logo abaixo da base, dentro das bordas do trecho', () => {
    expect(tracos(linhas, { acao: 'sublinhado', rugosidade: 0 }).map((traco) => traco.d)).toEqual(['M10 36.2 L170 36.2', 'M10 62.2 L100 62.2']);
  });
  test.each<Acao>(['marca_texto', 'grifo', 'sublinhado', 'caixa', 'circulo', 'colchete', 'riscado', 'xis'])('%s produz somente comandos SVG e números finitos', (acao) => {
    for (const traco of tracos(linhas, { acao })) {
      expect(traco.d).toMatch(/^M[-\d. ]+[MLQCZ\d. \-]*$/);
      expect(traco.d).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
  test('colchete envolve o conjunto, no lado escolhido', () => {
    expect(tracos(linhas, { acao: 'colchete' })).toHaveLength(1);
    expect(tracos(linhas, { acao: 'colchete', lado: 'direita', rugosidade: 0 })[0]?.d).toBe('M166 18 L172 18 M172 18 L172 66 M172 66 L166 66');
  });
  test('retângulos vazios ou inválidos não geram caminhos', () => {
    expect(tracos([{ x: NaN, y: 0, largura: 10, altura: 20 }, { x: 0, y: 0, largura: 0, altura: 20 }])).toEqual([]);
  });
});

import { juntarPorLinha } from './geometria';
describe('grifo no PDF', () => {
  test('palavras da mesma linha viram um retângulo; linhas diferentes continuam separadas', () => {
    const palavras = [{ x: 10, y: 100, largura: 40, altura: 14 }, { x: 54, y: 101, largura: 30, altura: 13 }, { x: 88, y: 100, largura: 20, altura: 14 },
      { x: 10, y: 120, largura: 50, altura: 14 }];
    expect(juntarPorLinha(palavras)).toEqual([{ x: 10, y: 100, largura: 98, altura: 14 }, { x: 10, y: 120, largura: 50, altura: 14 }]);
    // Um vão maior que a altura da linha (outra coluna, outro trecho) não se junta.
    expect(juntarPorLinha([{ x: 10, y: 100, largura: 20, altura: 14 }, { x: 80, y: 100, largura: 20, altura: 14 }])).toHaveLength(2);
  });
});
