/**
 * Telas do áudio gerado no app (J106), com `fetch` falso: Configurações → Áudio (a chave nunca volta
 * para a tela), "Gerar narração" (estimativa, confirmação, progresso e erro) e o acompanhamento.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import type { AncoraV1 } from '@margem/contratos';
import { rotaDoCaminho, caminhoDaRota } from '../biblioteca/rotas';
import { Configuracoes } from './Configuracoes';
import { GerarNarracao, SituacaoDaGeracao } from './GerarNarracao';
import { useNarracao } from './useNarracao';
import dados from '../../tests/fixtures/j18.json';
import type { SnapshotCapitulo } from '../leitor/tipos';
import { EstudoDoCapitulo } from '../leitor/EstudoDoCapitulo';
import { rotuloDoCusto, type ConfiguracaoDeAudio, type PreviaDaNarracao, type SituacaoDaNarracao } from './api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const V = '01KV0000000000000000000010';
const S = '01KS0000000000000000000010';
const CHAVE = 'sk_chave_digitada_0123456789';

interface Pedido { url: string; metodo: string; corpo: unknown }
type Resposta = { status?: number; corpo: unknown };
function falsificar(rotas: (p: Pedido) => Resposta | undefined): Pedido[] {
  const pedidos: Pedido[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, inicio?: RequestInit) => {
    const pedido = { url, metodo: inicio?.method ?? 'GET', corpo: typeof inicio?.body === 'string' ? JSON.parse(inicio.body) as unknown : null };
    pedidos.push(pedido);
    const r = rotas(pedido) ?? { status: 404, corpo: { erro: 'nao_encontrado' } };
    return Promise.resolve(new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } }));
  }));
  return pedidos;
}

const MODELOS = [
  { id: 'eleven_multilingual_v2', nome: 'Multilingual v2 (mais natural)', creditos_por_caractere: 1, usd_por_mil: 0.08 },
  { id: 'eleven_flash_v2_5', nome: 'Flash v2.5 (mais barato e rápido)', creditos_por_caractere: 0.5, usd_por_mil: 0.04 },
];
const config = (mudar: Partial<ConfiguracaoDeAudio> = {}): ConfiguracaoDeAudio => ({
  provedor: 'elevenlabs', chave: { configurada: false, final: null }, voz: null, modelo_id: 'eleven_multilingual_v2', modelos: MODELOS,
  guardada: 'Só neste computador, num arquivo de segredos da pasta de dados do Margem (permissão 0600). Nunca vai para o banco nem para o Git.', ...mudar,
});

describe('rota', () => {
  test('/configuracoes', () => {
    expect(rotaDoCaminho('/configuracoes')).toEqual({ nome: 'configuracoes' });
    expect(caminhoDaRota({ nome: 'configuracoes' })).toBe('/configuracoes');
  });
});

describe('Configurações → Primeiros passos (V-T1)', () => {
  test('uma seção das Configurações, com o endereço próprio; o endereço antigo leva até ela', () => {
    expect(rotaDoCaminho('/configuracoes/primeiros-passos')).toEqual({ nome: 'configuracoes', secao: 'primeiros-passos' });
    expect(rotaDoCaminho('/primeiros-passos')).toEqual({ nome: 'configuracoes', secao: 'primeiros-passos' });
    expect(caminhoDaRota({ nome: 'configuracoes', secao: 'primeiros-passos' })).toBe('/configuracoes/primeiros-passos');
  });

  test('as abas trocam a seção: Geral tem o áudio; Primeiros passos tem as etapas', async () => {
    falsificar((p) => p.url === '/api/configuracoes/audio' ? { corpo: config() } : undefined);
    const ir = vi.fn();
    const { rerender } = render(<Configuracoes ir={ir} />);
    const secoes = screen.getByRole('navigation', { name: 'Seções das configurações' });
    expect(within(secoes).getByRole('link', { name: 'Geral' }).getAttribute('aria-current')).toBe('page');
    await screen.findByLabelText('Chave da API da ElevenLabs');
    fireEvent.click(within(secoes).getByRole('link', { name: 'Primeiros passos' }));
    expect(ir).toHaveBeenCalledWith({ nome: 'configuracoes', secao: 'primeiros-passos' });
    rerender(<Configuracoes ir={ir} secao="primeiros-passos" />);
    expect(within(secoes).getByRole('link', { name: 'Primeiros passos' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Primeiros passos' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Etapas' })).toBeDefined();
    expect(screen.queryByLabelText('Chave da API da ElevenLabs')).toBeNull();
    expect(document.title).toBe('Primeiros passos · Configurações · Margem');
  });
});

describe('Configurações → Áudio', () => {
  test('sem chave: campo de senha, aviso de onde a chave fica; salvar mostra só o final e limpa o campo', async () => {
    let atual = config();
    const pedidos = falsificar((p) => {
      if (p.url === '/api/configuracoes/audio') return { corpo: atual };
      if (p.url === '/api/configuracoes/audio/chave' && p.metodo === 'PUT') { atual = config({ chave: { configurada: true, final: '6789' } }); return { corpo: atual }; }
      if (p.url === '/api/configuracoes/audio/vozes') return { corpo: { vozes: [{ id: 'v1', nome: 'Clara' }, { id: 'v2', nome: 'Bento', categoria: 'cloned' }] } };
      if (p.url === '/api/configuracoes/audio/preferencias') { atual = config({ chave: atual.chave, voz: { id: 'v2', nome: 'Bento' } }); return { corpo: atual }; }
      return undefined;
    });
    render(<Configuracoes />);
    const campo = await screen.findByLabelText('Chave da API da ElevenLabs');
    expect(campo).toHaveProperty('type', 'password');
    expect(screen.getByText(/Só neste computador/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Voz' })).toBeNull();
    fireEvent.change(campo, { target: { value: `  ${CHAVE} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar chave' }));
    await screen.findByText('Chave guardada neste computador.');
    expect(pedidos.find((p) => p.metodo === 'PUT')?.corpo).toEqual({ chave: CHAVE });
    expect(screen.getByText('6789')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CHAVE);
    expect(screen.queryByLabelText('Chave da API da ElevenLabs')).toBeNull();
    // Com a chave, as vozes da conta e o modelo.
    fireEvent.click(await screen.findByRole('combobox', { name: 'Voz' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bento (clonada)' }));
    await waitFor(() => expect(pedidos.find((p) => p.url === '/api/configuracoes/audio/preferencias')?.corpo).toEqual({ voz_id: 'v2', voz_nome: 'Bento', modelo_id: 'eleven_multilingual_v2' }));
  });

  test('testar chave: sucesso com saldo e erro com a frase do servidor', async () => {
    let tentativa = 0;
    falsificar((p) => {
      if (p.url === '/api/configuracoes/audio') return { corpo: config({ chave: { configurada: true, final: 'abcd' } }) };
      if (p.url === '/api/configuracoes/audio/vozes') return { corpo: { vozes: [] } };
      if (p.url === '/api/configuracoes/audio/testar') {
        tentativa += 1;
        return tentativa === 1 ? { corpo: { ok: true, creditos_restantes: 12_345 } }
          : { status: 402, corpo: { erro: 'sem_creditos', detalhe: 'Sem créditos na conta da ElevenLabs para esta narração.' } };
      }
      return undefined;
    });
    render(<Configuracoes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar chave' }));
    expect((await screen.findByRole('status')).textContent).toContain('Restam 12.345 créditos');
    fireEvent.click(screen.getByRole('button', { name: 'Testar chave' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Sem créditos');
  });
});

const previa = (mudar: Partial<PreviaDaNarracao> = {}): PreviaDaNarracao => ({
  caracteres: 1234, pedidos: 1, creditos: 1234, custo_usd: 0.1, cenas: 12, modelo_id: 'eleven_multilingual_v2', modelo_nome: 'Multilingual v2 (mais natural)',
  voz_id: 'v1', voz_nome: 'Clara', titulo: 'Narração · Um', ...mudar,
});
const TRECHO: AncoraV1 = { versao_id: V, bloco_id: '01KB0000000000000000000010', inicio_utf16: 0, fim_utf16: 5, citacao: 'Texto', prefixo: '', sufixo: ' aqui' };

describe('Gerar narração', () => {
  test('mostra a estimativa, troca para o trecho e gera com os caracteres confirmados', async () => {
    const pedidos = falsificar((p) => {
      if (p.url.endsWith('/narracao/previa')) return { corpo: p.corpo && (p.corpo as { trecho?: unknown }).trecho ? previa({ caracteres: 5, creditos: 5, custo_usd: 0, cenas: 1 }) : previa() };
      if (p.url.endsWith('/narracao') && p.metodo === 'POST') return { status: 202, corpo: { estado: 'pendente', pedido_id: 'P', progresso: null, chave_configurada: true } };
      return undefined;
    });
    const aoPedir = vi.fn();
    render(<GerarNarracao versaoId={V} secaoId={S} trecho={TRECHO} situacao={null} aoPedir={aoPedir} aoConfigurar={() => undefined} />);
    expect(await screen.findByText(/1 frase · 5 caracteres/)).toBeTruthy();
    expect(screen.getByText(/menos de US\$ 0,01/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Capítulo inteiro' }));
    expect(await screen.findByText(/12 frases · 1\.234 caracteres/)).toBeTruthy();
    expect(screen.getByText(/1\.234 créditos · US\$ 0,10/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar narração · 1.234 caracteres' }));
    await waitFor(() => expect(aoPedir).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pendente' })));
    expect(pedidos.find((p) => p.metodo === 'POST' && p.url.endsWith('/narracao'))?.corpo).toEqual({ caracteres_confirmados: 1234 });
  });

  test('sem voz escolhida: nada de botão de gerar, só o caminho para escolher', async () => {
    falsificar((p) => p.url.endsWith('/previa') ? { corpo: previa({ voz_id: null, voz_nome: null }) } : undefined);
    const aoConfigurar = vi.fn();
    render(<GerarNarracao versaoId={V} secaoId={S} trecho={null} situacao={null} aoPedir={() => undefined} aoConfigurar={aoConfigurar} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Configurações → Áudio' }));
    expect(aoConfigurar).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Gerar narração/ })).toBeNull();
  });

  test('erro ao pedir e situação em curso, com progresso, falha e pronto', async () => {
    falsificar((p) => p.url.endsWith('/previa') ? { corpo: previa() } : { status: 409, corpo: { erro: 'estimativa_mudou', detalhe: 'A estimativa mudou; confira de novo antes de gerar.' } });
    render(<GerarNarracao versaoId={V} secaoId={S} trecho={null} situacao={null} aoPedir={() => undefined} aoConfigurar={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Gerar narração ·/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('A estimativa mudou');
    cleanup();
    const base = { pedido_id: 'P', chave_configurada: true } as const;
    const { rerender } = render(<SituacaoDaGeracao situacao={{ ...base, estado: 'executando', progresso: { feitos: 1, total: 3 } }} />);
    expect(screen.getByText('Gerando a narração: parte 2 de 3.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33');
    rerender(<SituacaoDaGeracao situacao={{ ...base, estado: 'falhou', progresso: null, codigo: 'chave_invalida', motivo: 'Chave inválida: a ElevenLabs recusou a chave.' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Chave inválida');
    const ouvir = vi.fn();
    rerender(<SituacaoDaGeracao situacao={{ ...base, estado: 'pronto', progresso: null }} aoOuvir={ouvir} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir agora' }));
    expect(ouvir).toHaveBeenCalled();
  });

  test('custo em reais de referência formatado', () => {
    expect(rotuloDoCusto(0.004)).toBe('menos de US$ 0,01');
    expect(rotuloDoCusto(1.5)).toBe('US$ 1,50');
  });
});

describe('acompanhamento', () => {
  test('consulta enquanto gera e conta a narração que ficou pronta; resposta estranha é ignorada', async () => {
    const estados: SituacaoDaNarracao[] = [
      { estado: 'executando', pedido_id: 'P', progresso: { feitos: 0, total: 2 }, chave_configurada: true },
      { estado: 'pronto', pedido_id: 'P', progresso: null, chave_configurada: true },
    ];
    falsificar(() => ({ corpo: estados.length > 1 ? estados.shift() : estados[0] }));
    const { result } = renderHook(() => useNarracao(V, S, 300));
    await waitFor(() => expect(result.current.situacao?.estado).toBe('executando'));
    await waitFor(() => expect(result.current.situacao?.estado).toBe('pronto'));
    expect(result.current.prontas).toBe(1);
    cleanup();
    vi.unstubAllGlobals();
    falsificar(() => ({ corpo: { qualquer: 'coisa' } }));
    const outro = renderHook(() => useNarracao(V, S, 10));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(outro.result.current.situacao).toBeNull();
  });
});

describe('no leitor (menu Ouvir)', () => {
  const snapshot = dados.snapshot as SnapshotCapitulo;
  const leitura = (narracao: Partial<SituacaoDaNarracao>) => falsificar((p) => {
    if (p.url.endsWith('/midias')) return { corpo: { midias: [] } };
    if (p.url.endsWith('/audios')) return { corpo: { audios: [] } };
    if (p.url.endsWith('/visuais')) return { corpo: { visuais: [] } };
    if (p.url.endsWith('/narracao')) return { corpo: { estado: 'nenhum', pedido_id: null, progresso: null, ...narracao } };
    if (p.url.endsWith('/narracao/previa')) return { corpo: previa() };
    return { corpo: {} };
  });

  test('sem chave: um convite discreto que leva às Configurações, nunca um botão morto', async () => {
    leitura({ chave_configurada: false });
    render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvir' }));
    const convite = await screen.findByRole('button', { name: /Narração com a sua chave/ });
    expect(convite.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: /^Gerar narração/ })).toBeNull();
    fireEvent.click(convite);
    expect(window.location.pathname).toBe('/configuracoes');
    window.history.replaceState(null, '', '/');
  });

  test('com chave: "Gerar narração" abre o painel com a estimativa; gerando, o menu mostra o progresso', async () => {
    leitura({ chave_configurada: true });
    render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvir' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Gerar narração/ }));
    expect(await screen.findByRole('region', { name: 'Gerar narração' })).toBeTruthy();
    expect(await screen.findByText(/12 frases · 1\.234 caracteres/)).toBeTruthy();
    cleanup(); vi.unstubAllGlobals();
    leitura({ chave_configurada: true, estado: 'executando', progresso: { feitos: 2, total: 5 } });
    render(<EstudoDoCapitulo documento_id={dados.snapshot.documento_id} snapshot={snapshot} aoAtualizar={async () => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvir' }));
    expect(await screen.findByRole('button', { name: /Gerando a narração… 2\/5/ })).toBeTruthy();
  });
});
