/** U-01/W-05: conectar ao ChatGPT pelo app de computador, sem comandos de terminal nem Docker. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProvedorDaInstalacao } from './ContextoDaInstalacao';
import { avisoDaInstalacao, COMANDO_LOGIN_DOCKER, type EstadoDaInstalacao } from './estado';
import { AvisoDaInstalacao } from './PrimeiraExecucao';
import { ConectarAoChatGPT, ContaDoChatGPT, fraseDaFalhaDoLogin } from './ConectarAoChatGPT';
import type { EventoDoLoginNoApp, PonteDoChatGPT } from './ponte-do-chatgpt';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); delete (window as { margemDesktop?: unknown }).margemDesktop; });

const BASE: EstadoDaInstalacao = {
  versao: 1, banco: { ok: true }, motor: { ok: true },
  codex: { encontrado: true, versao: 'codex-cli 0.160.0', compativel: true, logado: false, conta: null, executor: 'codex' },
  cota: { esgotada: false, volta_em: null },
  primeira_execucao: { concluida: true, concluida_em: '2026-10-12T12:00:00.000Z', exemplo_documento_id: null },
  pronto: false, origem: 'desktop',
};
const AUSENTE: EstadoDaInstalacao = { ...BASE, codex: { ...BASE.codex, encontrado: false, versao: null, compativel: false, logado: null } };
const LOGADO: EstadoDaInstalacao = { ...BASE, codex: { ...BASE.codex, logado: true, conta: 'chatgpt' }, pronto: true };

/** Uma ponte falsa: `entrar` espera `concluir`, e os eventos saem por `emitir`. */
function ponteFalsa(estado: { encontrado: boolean; logado: boolean | null } = { encontrado: true, logado: false }) {
  const ouvintes = new Set<(evento: EventoDoLoginNoApp) => void>();
  let concluir: (ok: boolean) => void = () => {};
  const ponte = {
    estado: vi.fn(() => Promise.resolve({ ...estado, conta: null })),
    entrar: vi.fn((dispositivo: boolean) => new Promise<boolean>((resolver) => { void dispositivo; concluir = resolver; })),
    cancelar: vi.fn(() => { concluir(false); return Promise.resolve(); }),
    abrirLink: vi.fn(() => Promise.resolve()),
    aoEvento: vi.fn((ouvir: (evento: EventoDoLoginNoApp) => void) => { ouvintes.add(ouvir); return () => { ouvintes.delete(ouvir); }; }),
  } satisfies PonteDoChatGPT;
  return { ponte, emitir: (evento: EventoDoLoginNoApp) => { act(() => { for (const o of ouvintes) o(evento); }); }, concluir: (ok: boolean) => concluir(ok) };
}

const TERMINAL = /npm|docker|codex login|terminal/i;

describe('o aviso no app de computador', () => {
  test('deslogado: o botão no lugar dos comandos; "Conectar novamente" se a conta já esteve conectada', () => {
    const primeira = avisoDaInstalacao(BASE, new Date(), false)!;
    expect(primeira).toMatchObject({ tipo: 'deslogado', comandos: [], acao: 'conectar' });
    expect(`${primeira.titulo} ${primeira.texto}`).not.toMatch(TERMINAL);
    const caiu = avisoDaInstalacao(BASE, new Date(), true)!;
    expect(caiu).toMatchObject({ acao: 'reconectar', titulo: 'A conexão com o ChatGPT terminou.' });
    // Fora do app, os comandos de sempre.
    expect(avisoDaInstalacao({ ...BASE, origem: undefined }, new Date(), true)?.comandos.map((c) => c.comando)).toContain(COMANDO_LOGIN_DOCKER);
  });

  test('sem o Codex embutido: reinstalar o app, nada de npm', () => {
    const aviso = avisoDaInstalacao(AUSENTE)!;
    expect(aviso.tipo).toBe('ausente');
    expect(aviso.comandos).toEqual([]);
    expect(aviso.acao).toBeUndefined();
    expect(aviso.texto).toMatch(/Reinstale o Margem/);
    expect(`${aviso.titulo} ${aviso.texto}`).not.toMatch(TERMINAL);
    for (const outro of [{ ...BASE, motor: { ok: false } }, { ...BASE, codex: { ...LOGADO.codex, compativel: false } }]) {
      const a = avisoDaInstalacao(outro)!;
      expect(a.comandos).toEqual([]);
      expect(`${a.titulo} ${a.texto}`).not.toMatch(TERMINAL);
    }
  });

  test('a faixa do app mostra "Conectar ao ChatGPT"; o login conclui e a checagem é refeita sem memória', async () => {
    const { ponte, concluir } = ponteFalsa();
    (window as { margemDesktop?: unknown }).margemDesktop = { chatgpt: ponte };
    let atual = BASE;
    const obter = vi.fn((renovar?: boolean) => { void renovar; return Promise.resolve(atual); });
    render(<ProvedorDaInstalacao obter={obter}><AvisoDaInstalacao ir={() => {}} /></ProvedorDaInstalacao>);
    const faixa = await screen.findByRole('status', { name: 'Aviso da instalação' });
    expect(faixa.querySelector('code')).toBeNull();
    expect(faixa.textContent).not.toMatch(TERMINAL);
    fireEvent.click(screen.getByRole('button', { name: 'Conectar ao ChatGPT' }));
    expect(ponte.entrar).toHaveBeenCalledWith(false);
    await screen.findByText('Termine o login no navegador e volte para cá.');
    atual = LOGADO;
    await act(async () => { concluir(true); await Promise.resolve(); });
    await waitFor(() => expect(obter).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Aviso da instalação' })).toBeNull());
    expect(window.localStorage.getItem('margem:chatgpt-ja-conectado')).toBe('1');
  });
});

describe('o botão', () => {
  function montar(ponte: PonteDoChatGPT, reconectar = false) {
    render(<ProvedorDaInstalacao obter={() => Promise.resolve(BASE)}><ConectarAoChatGPT ponte={ponte} reconectar={reconectar} /></ProvedorDaInstalacao>);
  }

  test('com código: mostra o código e o link da página; Cancelar volta ao começo', async () => {
    const { ponte, emitir } = ponteFalsa();
    montar(ponte, true);
    fireEvent.click(screen.getByRole('button', { name: 'Usar um código' }));
    expect(ponte.entrar).toHaveBeenCalledWith(true);
    expect(screen.getByText('Gerando o código…')).toBeDefined();
    emitir({ tipo: 'link', valor: 'https://auth.openai.com/codex/device' });
    emitir({ tipo: 'codigo', valor: 'ABCD-12EF' });
    expect(screen.getByLabelText('Código: ABCD-12EF').textContent).toBe('ABCD-12EF');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir a página de login' }));
    expect(ponte.abrirLink).toHaveBeenCalledWith('https://auth.openai.com/codex/device');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Conectar novamente' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('o login que não termina vira uma frase, sem a saída da CLI', async () => {
    const { ponte, concluir } = ponteFalsa();
    montar(ponte);
    fireEvent.click(screen.getByRole('button', { name: 'Conectar ao ChatGPT' }));
    await act(async () => { concluir(false); await Promise.resolve(); });
    expect((await screen.findByRole('alert')).textContent).toBe(fraseDaFalhaDoLogin(undefined));
  });

  test('sem o Codex embutido, a falha diz para reinstalar', async () => {
    const { ponte, concluir } = ponteFalsa({ encontrado: false, logado: null });
    montar(ponte);
    fireEvent.click(screen.getByRole('button', { name: 'Conectar ao ChatGPT' }));
    await act(async () => { concluir(false); await Promise.resolve(); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Reinstale o Margem/);
  });

  test('sair da tela com o login correndo cancela o login', () => {
    const { ponte } = ponteFalsa();
    montar(ponte);
    fireEvent.click(screen.getByRole('button', { name: 'Conectar ao ChatGPT' }));
    cleanup();
    expect(ponte.cancelar).toHaveBeenCalled();
  });
});

describe('Configurações → Conta do ChatGPT', () => {
  test('fora do app, a seção não existe', () => {
    const { container } = render(<ContaDoChatGPT ponte={null} />);
    expect(container.textContent).toBe('');
  });

  test('deslogado mostra o botão; conectado, só o estado', async () => {
    const { ponte } = ponteFalsa();
    render(<ProvedorDaInstalacao obter={() => Promise.resolve(BASE)}><ContaDoChatGPT ponte={ponte} /></ProvedorDaInstalacao>);
    expect(await screen.findByText('Ainda não conectado.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Conectar ao ChatGPT' })).toBeDefined();
    cleanup();
    const logado = ponteFalsa({ encontrado: true, logado: true });
    render(<ContaDoChatGPT ponte={logado.ponte} />);
    expect(await screen.findByText('Conectado à sua conta do ChatGPT.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Conectar/ })).toBeNull();
  });

  test('sem o Codex embutido: reinstalar', async () => {
    const { ponte } = ponteFalsa({ encontrado: false, logado: null });
    render(<ContaDoChatGPT ponte={ponte} />);
    expect((await screen.findByRole('status')).textContent).toMatch(/Reinstale o Margem com o instalador de margem\.dev/);
  });
});

describe('W-06 junto: a CLI que o sistema não deixou rodar', () => {
  test('a frase do app chega à tela; a saída em inglês, não', () => {
    const antivirus = 'O sistema não deixou o Margem rodar a CLI do Codex. Costuma ser o antivírus ou uma política da empresa.';
    expect(fraseDaFalhaDoLogin(antivirus)).toBe(antivirus);
    expect(fraseDaFalhaDoLogin('Error: token exchange failed')).toBe(fraseDaFalhaDoLogin(undefined));
    expect(fraseDaFalhaDoLogin('O login não terminou.')).toBe(fraseDaFalhaDoLogin(undefined));
  });
});
