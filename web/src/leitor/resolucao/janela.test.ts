import { expect, test } from 'vitest';
import { posicaoFlutuante } from './janela';

const tela = { largura: 1440, altura: 900 };
test('janela flutuante: à direita do exercício se couber, senão à esquerda, senão na borda; dentro da tela', () => {
  expect(posicaoFlutuante({ left: 100, top: 200, width: 500, height: 120 }, 600, tela)).toEqual({ left: 616, top: 200 });
  expect(posicaoFlutuante({ left: 700, top: 200, width: 500, height: 120 }, 600, tela)).toEqual({ left: 264, top: 200 });
  expect(posicaoFlutuante({ left: 100, top: 700, width: 1200, height: 120 }, 600, tela)).toEqual({ left: 1004, top: 284 });
  expect(posicaoFlutuante(null, 600, tela)).toEqual({ left: 1004, top: 80 });
});
