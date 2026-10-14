import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextoDeAparencia } from './ContextoDeAparencia';
import { MarcasNasConfiguracoes } from './MarcasNasConfiguracoes';
import { lerPreferencias } from './preferencias';

afterEach(() => { cleanup(); try { localStorage.removeItem('margem:aparencia'); } catch { /* sem storage */ } });

test('Configurações › Marcas: uma opção só, ligada por padrão, guardada nas preferências do leitor', () => {
  render(<ContextoDeAparencia><MarcasNasConfiguracoes /></ContextoDeAparencia>);
  const opcao = screen.getByRole('switch', { name: 'Mostrar todas as marcas ao abrir' });
  expect(opcao.getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByText(/atenção/iu)).toBeNull();
  fireEvent.click(opcao);
  expect(screen.getByRole('switch', { name: 'Mostrar todas as marcas ao abrir' }).getAttribute('aria-checked')).toBe('false');
  expect(lerPreferencias().marcasAoAbrir).toBe(false);
});
