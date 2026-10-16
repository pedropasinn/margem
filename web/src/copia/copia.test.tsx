import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CopiaDeSeguranca } from './CopiaDeSeguranca';
import { ponteDaCopia, type LocaisDaBiblioteca, type PonteDaCopia } from './ponte';

afterEach(() => { cleanup(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

const LOCAIS: LocaisDaBiblioteca = {
  biblioteca: 'C:\\Users\\Ana\\OneDrive\\Documentos\\Margem', banco: 'C:\\Users\\Ana\\AppData\\Local\\Margem\\bancos\\0123456789abcdef01234567',
  bancoSeparado: true, sincronizada: 'OneDrive', copiaAntesDeMigrar: null, ultimaCopia: null,
};

function ponteFalsa(locais: LocaisDaBiblioteca = LOCAIS) {
  return { locais: vi.fn(() => Promise.resolve(locais)), fazer: vi.fn(), mostrar: vi.fn() } satisfies PonteDaCopia;
}

describe('Configurações → Cópia de segurança (U-03)', () => {
  test('no navegador não há ponte, e a seção não aparece', () => {
    expect(ponteDaCopia()).toBeNull();
    const { container } = render(<CopiaDeSeguranca />);
    expect(container.innerHTML).toBe('');
    (window as { margemDesktop?: unknown }).margemDesktop = { copia: ponteFalsa() };
    expect(ponteDaCopia()).not.toBeNull();
  });

  test('mostra os dois lugares e avisa que o OneDrive não leva as notas (W-01)', async () => {
    const ponte = ponteFalsa();
    render(<CopiaDeSeguranca ponte={ponte} />);
    expect(await screen.findByText(LOCAIS.banco)).toBeTruthy();
    expect(screen.getByText(LOCAIS.biblioteca)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('O OneDrive não leva as notas');
    expect(screen.getByText('Nenhuma cópia de segurança feita neste computador ainda.')).toBeTruthy();
    const [biblioteca, banco] = screen.getAllByRole('button', { name: 'Mostrar' });
    fireEvent.click(banco as HTMLElement);
    fireEvent.click(biblioteca as HTMLElement);
    expect(ponte.mostrar.mock.calls).toEqual([['banco'], ['biblioteca']]);
    fireEvent.click(screen.getByRole('button', { name: 'Fazer cópia de segurança…' }));
    expect(ponte.fazer).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Como restaurar' }).getAttribute('href')).toBe('https://margem.dev/docs/backup/#restaurar');
  });

  test('banco dentro da biblioteca: sem o aviso; a última cópia aparece com a data', async () => {
    const ponte = ponteFalsa({ ...LOCAIS, bancoSeparado: false, sincronizada: null, banco: '/home/ana/Margem/.margem/banco', biblioteca: '/home/ana/Margem',
      ultimaCopia: { pasta: '/media/ana/Disco/Cópia do Margem 2026-10-16 14h05', criada_em: new Date(2026, 9, 16, 14, 5).toISOString() } });
    render(<CopiaDeSeguranca ponte={ponte} />);
    expect(await screen.findByText(/Última cópia em 16\/10\/2026 às 14:05/u)).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar a pasta' }));
    expect(ponte.mostrar).toHaveBeenCalledWith('ultima');
  });
});
