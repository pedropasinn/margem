import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Capa } from './Capa';

afterEach(cleanup);
test('capa PDF usa a versão, volta à gerada ao falhar e tenta uma versão nova', () => {
  const props = { id: 'doc', titulo: 'Livro', autor: 'Autora', formato: 'pdf', tamanho: 'mini' as const };
  const tela = render(<Capa {...props} versao_id="v1" />);
  const imagem = tela.container.querySelector('img')!;
  expect(imagem.getAttribute('src')).toBe('/api/versoes/v1/capa');
  expect(imagem.getAttribute('loading')).toBe('lazy');
  fireEvent.error(imagem);
  expect(tela.container.querySelector('img')).toBeNull();
  expect(tela.container.querySelector('.capa-titulo')?.textContent).toBe('L');
  tela.rerender(<Capa {...props} versao_id="v2" />);
  expect(tela.container.querySelector('img')?.getAttribute('src')).toBe('/api/versoes/v2/capa');
  tela.rerender(<Capa {...props} formato="md" versao_id="v2" />);
  expect(tela.container.querySelector('img')).toBeNull();
});
