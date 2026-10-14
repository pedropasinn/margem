import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { armazemEmMemoria } from '../onboarding/armazem';
import { ProvedorDoOnboarding } from '../onboarding/ContextoDoOnboarding';
import { ProvedorDaInstalacao, usarInstalacao } from './ContextoDaInstalacao';
import {
  avisoDaInstalacao, COMANDO_LOGIN_DOCKER, mostrarPrimeiraExecucao, pareceEstadoDaInstalacao, quandoVolta, situacaoDoCodex,
  type EstadoDaInstalacao,
} from './estado';
import { AvisoDaInstalacao, AvisoDoCodexCurto, BoasVindasDaInstalacao } from './PrimeiraExecucao';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const PRONTO: EstadoDaInstalacao = {
  versao: 1, banco: { ok: true }, motor: { ok: true },
  codex: { encontrado: true, versao: 'codex-cli 0.160.0', compativel: true, logado: true, conta: 'chatgpt', executor: 'codex' },
  cota: { esgotada: false, volta_em: null },
  primeira_execucao: { concluida: false, concluida_em: null, exemplo_documento_id: null },
  pronto: true,
};
const com = (mudanca: Partial<EstadoDaInstalacao> & { codexParcial?: Partial<EstadoDaInstalacao['codex']> }): EstadoDaInstalacao => {
  const { codexParcial, ...resto } = mudanca;
  return { ...PRONTO, ...resto, codex: { ...PRONTO.codex, ...codexParcial } };
};
const DESLOGADO = com({ codexParcial: { logado: false, conta: null }, pronto: false });
const AUSENTE = com({ codexParcial: { encontrado: false, versao: null, compativel: false, logado: null, conta: null }, pronto: false });
const concluida = (estado: EstadoDaInstalacao): EstadoDaInstalacao => ({ ...estado, primeira_execucao: { ...estado.primeira_execucao, concluida: true, concluida_em: '2026-10-12T12:00:00.000Z' } });

describe('o que a interface diz', () => {
  test('situação do Codex, na ordem em que importa', () => {
    expect(situacaoDoCodex(PRONTO.codex)).toBe('pronto');
    expect(situacaoDoCodex(AUSENTE.codex)).toBe('ausente');
    expect(situacaoDoCodex(DESLOGADO.codex)).toBe('deslogado');
    expect(situacaoDoCodex({ ...PRONTO.codex, compativel: false })).toBe('incompativel');
    expect(situacaoDoCodex({ ...AUSENTE.codex, executor: 'falso' })).toBe('falso');
    expect(situacaoDoCodex({ ...PRONTO.codex, logado: null })).toBe('desconhecido');
  });

  test('cada problema vira um aviso com o que fazer; tudo certo, nenhum', () => {
    expect(avisoDaInstalacao(PRONTO)).toBeNull();
    const deslogado = avisoDaInstalacao(DESLOGADO)!;
    expect(deslogado.tipo).toBe('deslogado');
    expect(deslogado.comandos.map((c) => c.comando)).toEqual([COMANDO_LOGIN_DOCKER, 'codex login']);
    expect(avisoDaInstalacao(AUSENTE)?.tipo).toBe('ausente');
    expect(avisoDaInstalacao(com({ codexParcial: { compativel: false } }))?.texto).toContain('codex-cli 0.160.0');
    expect(avisoDaInstalacao(com({ motor: { ok: false } }))?.tipo).toBe('motor');
    expect(avisoDaInstalacao(com({ banco: { ok: false } }))?.tipo).toBe('banco');
    const cota = avisoDaInstalacao(com({ cota: { esgotada: true, volta_em: '2026-10-12T17:30:00.000Z' } }), new Date('2026-10-12T12:00:00.000Z'))!;
    expect(cota.tipo).toBe('cota');
    expect(cota.texto).toMatch(/continuam sozinhas.*previsão: às \d\d:\d\d/);
    // Nenhuma frase com o vocabulário do serviço.
    for (const aviso of [deslogado, cota, avisoDaInstalacao(AUSENTE)!]) expect(`${aviso.titulo} ${aviso.texto}`).not.toMatch(/adiad|job|worker|429|usage limit|CLI/i);
  });

  test('quando volta: hoje, amanhã ou com a data', () => {
    const agora = new Date(2026, 9, 12, 10, 0);
    expect(quandoVolta(new Date(2026, 9, 12, 14, 30).toISOString(), agora)).toBe('às 14:30');
    expect(quandoVolta(new Date(2026, 9, 13, 8, 0).toISOString(), agora)).toBe('amanhã às 08:00');
    expect(quandoVolta(new Date(2026, 9, 20, 9, 15).toISOString(), agora)).toBe('em 20/10 às 09:15');
    expect(quandoVolta(null, agora)).toBeNull();
  });

  test('o diálogo só aparece com a primeira execução pendente, fora do leitor e sem "Depois"', () => {
    expect(mostrarPrimeiraExecucao(PRONTO, false, false)).toBe(true);
    expect(mostrarPrimeiraExecucao(concluida(PRONTO), false, false)).toBe(false);
    expect(mostrarPrimeiraExecucao(PRONTO, true, false)).toBe(false);
    expect(mostrarPrimeiraExecucao(PRONTO, false, true)).toBe(false);
    expect(mostrarPrimeiraExecucao(null, false, false)).toBe(false);
  });

  test('resposta fora do formato não é estado', () => {
    expect(pareceEstadoDaInstalacao(PRONTO)).toBe(true);
    expect(pareceEstadoDaInstalacao({})).toBe(false);
    expect(pareceEstadoDaInstalacao(null)).toBe(false);
  });
});

/** Um `fetch` falso que registra as escritas e responde às rotas da primeira execução. */
function servico(estado: EstadoDaInstalacao) {
  const escritas: string[] = [];
  const fetch = vi.fn((url: string, inicio?: RequestInit) => {
    const responder = (corpo: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } }));
    if (inicio?.method === 'POST') escritas.push(`${url} ${new Headers(inicio.headers).get('X-Margem') ?? ''}`);
    if (url === '/api/estado-instalacao/exemplo') return responder({ documento_id: '0000000000000000000000EX01', versao_id: '0000000000000000000000VR01', marcas: 6, criado: true }, 201);
    if (url === '/api/estado-instalacao/concluir') return responder({ concluida: true, concluida_em: '2026-10-12T12:00:00.000Z' });
    if (url.startsWith('/api/estado-instalacao')) return responder(estado);
    return responder({ erro: 'nao_simulada' }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return { escritas, fetch };
}

function montar(estado: EstadoDaInstalacao, filhos: (estado: EstadoDaInstalacao) => React.ReactNode) {
  const armazem = armazemEmMemoria();
  render(<ProvedorDoOnboarding armazem={armazem} verificarUsoAnterior={() => Promise.resolve(false)}>
    <ProvedorDaInstalacao obter={() => Promise.resolve(estado)}>{filhos(estado)}</ProvedorDaInstalacao>
  </ProvedorDoOnboarding>);
  return armazem;
}

describe('tela de boas-vindas da instalação', () => {
  test('Codex deslogado: a checagem diz o que falta e dá o comando exato', () => {
    servico(DESLOGADO);
    montar(DESLOGADO, (estado) => <BoasVindasDaInstalacao estado={estado} ir={() => {}} aoFechar={() => {}} />);
    const dialogo = screen.getByRole('dialog', { name: 'Boas-vindas ao Margem' });
    expect(dialogo.textContent).toContain('Antes de pedir a primeira leitura');
    expect(dialogo.textContent).toContain('O Codex não está conectado à sua conta do ChatGPT.');
    expect(screen.getByText(COMANDO_LOGIN_DOCKER).tagName).toBe('CODE');
    expect(screen.getByText('codex login').tagName).toBe('CODE');
    expect(screen.getByRole('button', { name: /Abrir o exemplo já marcado/ })).toBeDefined();
  });

  test('porta 8730 ocupada (V-W9): o aviso do app e a identificação deste Margem aparecem na checagem', () => {
    const aviso = 'A porta 8730 está ocupada: outro programa está usando essa porta. Este Margem abriu na porta 8731; a extensão do navegador procura nas portas 8730 a 8739 e o encontra.';
    const estado = com({ avisos: [aviso], instancia: { id: 'a1b2-c3d4', porta: 8731 } });
    servico(estado);
    montar(estado, (e) => <BoasVindasDaInstalacao estado={e} ir={() => {}} aoFechar={() => {}} />);
    expect(screen.getByText(aviso).className).toContain('aviso');
    expect(screen.getByText('a1b2-c3d4').tagName).toBe('CODE');
    expect(screen.getByText(/Identificação deste Margem/).textContent).toContain('porta 8731');
  });

  test('tudo pronto: nada a fazer além de começar', () => {
    servico(PRONTO);
    montar(PRONTO, (estado) => <BoasVindasDaInstalacao estado={estado} ir={() => {}} aoFechar={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Tudo pronto para ler' })).toBeDefined();
    expect(screen.queryByText(COMANDO_LOGIN_DOCKER)).toBeNull();
  });

  test('V-D5: no app de computador o login não é conferido de novo; a tela apresenta os três jeitos de estudar', () => {
    const doDesktop = { ...DESLOGADO, origem: 'desktop' as const };
    servico(doDesktop);
    montar(doDesktop, (estado) => <BoasVindasDaInstalacao estado={estado} ir={() => {}} aoFechar={() => {}} />);
    const dialogo = screen.getByRole('dialog', { name: 'Boas-vindas ao Margem' });
    expect(dialogo.textContent).not.toContain('Antes de pedir a primeira leitura');
    expect(screen.queryByText(COMANDO_LOGIN_DOCKER)).toBeNull();
    expect(screen.queryByRole('list', { name: 'O que esta instalação precisa' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Três jeitos de estudar' })).toBeDefined();
    expect(dialogo.textContent).toMatch(/lê, assiste e observa/);
    expect(screen.getByRole('button', { name: /Abrir o exemplo já marcado/ })).toBeDefined();
  });

  test('"Concluir" grava no serviço e fecha as boas-vindas do onboarding deste navegador', async () => {
    const { escritas } = servico(PRONTO);
    const armazem = montar(PRONTO, (estado) => <BoasVindasDaInstalacao estado={estado} ir={() => {}} aoFechar={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(escritas).toEqual(['/api/estado-instalacao/concluir 1']));
    await waitFor(() => expect(armazem.atual?.boas_vindas).toBe('concluida'));
  });

  test('o exemplo é semeado pelo serviço, conclui a primeira execução e abre no leitor', async () => {
    const { escritas } = servico(PRONTO);
    const ir = vi.fn();
    const armazem = montar(PRONTO, (estado) => <BoasVindasDaInstalacao estado={estado} ir={ir} aoFechar={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir o exemplo já marcado/ }));
    await waitFor(() => expect(ir).toHaveBeenCalledWith({ nome: 'leitura', documento_id: '0000000000000000000000EX01' }));
    expect(escritas).toEqual(['/api/estado-instalacao/exemplo 1', '/api/estado-instalacao/concluir 1']);
    expect(armazem.atual?.exemplo_id).toBe('0000000000000000000000EX01');
  });

  test('depois de concluída, a tela não aparece mais (como na casca do app)', async () => {
    servico(PRONTO);
    function Casca() {
      const { estado } = usarInstalacao();
      return estado && mostrarPrimeiraExecucao(estado, false, false)
        ? <BoasVindasDaInstalacao estado={estado} ir={() => {}} aoFechar={() => {}} /> : <p>biblioteca</p>;
    }
    montar(PRONTO, () => <Casca />);
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }));
    await screen.findByText('biblioteca');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Esc fecha só nesta aba (nada é gravado)', () => {
    const { escritas } = servico(PRONTO);
    const fechar = vi.fn();
    montar(PRONTO, (estado) => <BoasVindasDaInstalacao estado={estado} ir={() => {}} aoFechar={fechar} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(fechar).toHaveBeenCalled();
    expect(escritas).toEqual([]);
  });
});

describe('avisos fora da primeira execução', () => {
  test('a faixa aparece com o Codex deslogado depois de concluída, e some ao dispensar', async () => {
    const estado = concluida(DESLOGADO);
    servico(estado);
    montar(estado, () => <AvisoDaInstalacao ir={() => {}} />);
    const faixa = await screen.findByRole('status', { name: 'Aviso da instalação' });
    expect(faixa.textContent).toContain(COMANDO_LOGIN_DOCKER);
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar o aviso' }));
    expect(screen.queryByRole('status', { name: 'Aviso da instalação' })).toBeNull();
  });

  test('onde se pede a leitura: uma frase com a faixa à vista; as instruções inteiras depois de dispensá-la', async () => {
    const estado = concluida(DESLOGADO);
    servico(estado);
    montar(estado, () => <><AvisoDaInstalacao ir={() => {}} /><div data-testid="acao"><AvisoDoCodexCurto /></div></>);
    await screen.findByRole('status', { name: 'Aviso da instalação' });
    const acao = screen.getByTestId('acao');
    expect(acao.textContent).toContain('o aviso no topo mostra o que fazer');
    expect(acao.querySelector('code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar o aviso' }));
    expect(acao.querySelector('code')?.textContent).toBe(COMANDO_LOGIN_DOCKER);
  });

  test('sem faixa enquanto a primeira execução está pendente (o diálogo já explica)', async () => {
    servico(DESLOGADO);
    montar(DESLOGADO, () => <AvisoDaInstalacao ir={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('status', { name: 'Aviso da instalação' })).toBeNull();
  });

  test('cota esgotada: a faixa e o aviso curto dizem que a leitura espera sozinha', async () => {
    const estado = concluida(com({ cota: { esgotada: true, volta_em: null } }));
    servico(estado);
    montar(estado, () => <><AvisoDaInstalacao ir={() => {}} /><AvisoDoCodexCurto /></>);
    await waitFor(() => expect(screen.getAllByText(/A cota do Codex da sua conta acabou por agora/)).toHaveLength(2));
  });

  test('serviço sem a rota (versão anterior): nenhum aviso, nada quebra', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"erro":"nao_encontrado"}', { status: 404 }))));
    render(<ProvedorDaInstalacao><AvisoDaInstalacao ir={() => {}} /><AvisoDoCodexCurto /><p>conteúdo</p></ProvedorDaInstalacao>);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('conteúdo')).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('MARGEM_AVISOS do app aparece na faixa e na checagem; não vira aviso curto', async () => {
    const SANDBOX = 'O Codex roda no sandbox próprio: o bwrap do sistema não funciona aqui.';
    const estado = concluida(com({ avisos: [SANDBOX, SANDBOX, ' '] }));
    servico(estado);
    montar(estado, () => <><AvisoDaInstalacao ir={() => {}} /><div data-testid="acao"><AvisoDoCodexCurto /></div></>);
    const faixa = await screen.findByRole('status', { name: 'Aviso da instalação' });
    expect(faixa.textContent).toContain('Um aviso sobre esta instalação.');
    expect(faixa.textContent).toContain(SANDBOX);
    expect(screen.getByTestId('acao').textContent).toBe('');
    expect(avisoDaInstalacao(concluida(com({ avisos: ['x'], cota: { esgotada: true, volta_em: null } })))?.tipo).toBe('cota');
  });

  test('ferramentas de mídia que faltam aparecem na checagem', () => {
    const estado = com({
      avisos: ['Aviso do app.'],
      ferramentas: {
        ffmpeg: { ok: false, origem: 'padrão', mensagem: 'ffmpeg não encontrado no PATH.' }, ffprobe: { ok: true, origem: 'padrão' },
        yt_dlp: { ok: true, origem: 'MARGEM_YT_DLP' }, codex: { ok: true, origem: 'padrão' },
      },
    });
    servico(estado);
    montar(estado, (e) => <BoasVindasDaInstalacao estado={e} ir={() => {}} aoFechar={() => {}} />);
    const lista = screen.getByRole('list', { name: 'O que esta instalação precisa' });
    expect(lista.textContent).toContain('Áudio e vídeo');
    expect(lista.textContent).toContain('ffmpeg não encontrado no PATH.');
    expect(lista.textContent).toContain('Vídeos do YouTube');
    expect(screen.getByRole('list', { name: 'Avisos sobre esta instalação' }).textContent).toBe('Aviso do app.');
  });
});

