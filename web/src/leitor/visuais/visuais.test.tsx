/**
 * J70 no leitor: visuais ancorados. Sem Mermaid real (o jsdom não mede SVG): o renderizador é
 * injetado; a higienização do SVG e a régua do core rodam de verdade.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AncoraV1, VisualV1 } from '@margem/contratos';
import { DiagramaMermaid, idDoNo, svgSeguro } from './DiagramaMermaid';
import { NotaDoVisual, PainelDoVisual, VisualAmpliado, rotuloDoVisual } from './Visuais';
import { seriesDosVisuais, useVisuais } from './useVisuais';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const V = '01K0000000000000000000V001';
const S = '01K0000000000000000000S001';
const B = '01K0000000000000000000B001';
const ancora: AncoraV1 = { versao_id: V, bloco_id: B, inicio_utf16: 0, fim_utf16: 4, citacao: 'Amor', prefixo: '', sufixo: ' é fogo' };
function visual(parcial: Partial<VisualV1> & Pick<VisualV1, 'id'>): VisualV1 {
  return { versao: 1, versao_id: V, secao_id: S, tipo: 'imagem', alvo: { tipo: 'trecho', ancora }, estado: 'pendente', diagnosticos: [],
    criado_em: '2026-09-28T22:00:00.000Z', atualizado_em: '2026-09-28T22:00:00.000Z', ...parcial };
}
const pronto = visual({ id: '01K0000000000000000000X002', estado: 'pronto', substitui: '01K0000000000000000000X001', pedido: 'Gravura, sem texto.',
  artefato: { tipo: 'png', sha256: 'a'.repeat(64), bytes: 10, largura: 1370, altura: 1148, descricao: 'Um coração em chamas.' } });
const falhou = visual({ id: '01K0000000000000000000X001', estado: 'falhou', motivo: 'O Codex terminou sem gerar imagem.' });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><style>.node rect{fill:#eee}</style><script>alert(2)</script>
  <g class="node" id="mermaid-x-flowchart-A-0"><rect width="10" height="10"/><text>Amor</text></g>
  <g class="node" id="mermaid-x-flowchart-B-1"><rect/><text>Síntese</text></g>
  <foreignObject><div>html</div></foreignObject><a href="javascript:alert(3)"><text>link</text></a></svg>`;

describe('séries e rótulos', () => {
  test('gerar de novo agrupa as versões na mais nova; visual sem substituto abre série própria', () => {
    const outro = visual({ id: '01K0000000000000000000X003', tipo: 'diagrama', alvo: { tipo: 'capitulo' } });
    const series = seriesDosVisuais([falhou, pronto, outro]);
    expect(series.map((s) => [s.atual.id, s.anteriores.map((a) => a.id)])).toEqual([[pronto.id, [falhou.id]], [outro.id, []]]);
    expect(rotuloDoVisual(outro, true)).toBe('Fluxograma do capítulo');
    expect(rotuloDoVisual({ tipo: 'imagem', alvo: { tipo: 'capitulo' } }, true)).toBe('Quadro do poema');
    expect(rotuloDoVisual({ tipo: 'imagem', alvo: { tipo: 'bloco', ancora } }, true)).toBe('Imagem da estrofe');
  });
});

describe('SVG do Mermaid', () => {
  test('higieniza: sem script, manipuladores, foreignObject nem links; o desenho e o estilo ficam', () => {
    const svg = svgSeguro(SVG)!;
    expect(svg).not.toBeNull();
    expect(svg.querySelector('script, foreignObject, a')).toBeNull();
    expect(svg.getAttribute('onload')).toBeNull();
    expect(svg.querySelectorAll('g.node')).toHaveLength(2);
    expect(svg.querySelector('style')?.textContent).toContain('.node rect');
    expect(idDoNo(svg.querySelector('g.node')!)).toBe('A');
  });

  test('nó com trecho vira botão que leva ao texto; nó sem trecho não', async () => {
    const aoCitar = vi.fn();
    const renderizar = vi.fn(() => Promise.resolve(SVG));
    render(<DiagramaMermaid id="x" codigo={'flowchart TD\nA["Amor"] --> B["Síntese"]'} nos={[{ id: 'A', rotulo: 'Amor', ancora }, { id: 'B', rotulo: 'Síntese' }]} aoCitar={aoCitar} renderizar={renderizar} />);
    const botao = await screen.findByRole('button', { name: 'Amor — ir ao trecho' });
    expect(screen.queryByRole('button', { name: /Síntese/u })).toBeNull();
    // Dois nós: o desenho sai na horizontal (J132); o código conferido continua TD.
    expect(renderizar).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-x-\d+$/u), 'flowchart LR\nA["Amor"] --> B["Síntese"]', false);
    fireEvent.click(botao);
    expect(aoCitar).toHaveBeenCalledWith(ancora);
    fireEvent.keyDown(botao, { key: 'Enter' });
    expect(aoCitar).toHaveBeenCalledTimes(2);
    expect(document.querySelector('script')).toBeNull();
  });

  test('código fora do subconjunto nem chega ao Mermaid', async () => {
    const renderizar = vi.fn(() => Promise.resolve(SVG));
    render(<DiagramaMermaid id="y" codigo={'%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA'} nos={[{ id: 'A', rotulo: 'a' }]} renderizar={renderizar} />);
    expect((await screen.findByRole('alert')).textContent).toContain('diretivas');
    expect(renderizar).not.toHaveBeenCalled();
  });
});

describe('nota, pedido e visualização', () => {
  test('a nota mostra o progresso, o erro com "Tentar de novo" e, pronta, a miniatura que amplia', () => {
    const tentar = vi.fn(); const abrir = vi.fn();
    const { rerender } = render(<NotaDoVisual serie={{ atual: visual({ id: '01K0000000000000000000X009', estado: 'executando' }), anteriores: [] }} rotulo="Imagem" ocupado={false} aoAbrir={abrir} aoTentarDeNovo={tentar} />);
    expect(screen.getByRole('status').textContent).toBe('O Codex está desenhando…');
    rerender(<NotaDoVisual serie={{ atual: falhou, anteriores: [] }} rotulo="Imagem" ocupado={false} aoAbrir={abrir} aoTentarDeNovo={tentar} />);
    // A falha é só um triângulo na margem; o motivo e as ações aparecem ao tocar.
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Imagem não saiu: ver o motivo' }));
    expect(screen.getByRole('alert').textContent).toBe('O Codex terminou sem gerar imagem.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(tentar).toHaveBeenCalledOnce();
    rerender(<NotaDoVisual serie={{ atual: pronto, anteriores: [falhou] }} rotulo="Imagem" ocupado={false} aoAbrir={abrir} aoTentarDeNovo={tentar} />);
    expect(screen.getByText('Imagem · v2')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Um coração em chamas.' }).getAttribute('src')).toBe(`/api/visuais/${pronto.id}/imagem`);
    fireEvent.click(screen.getByRole('button', { name: /Ampliar a imagem/u }));
    expect(abrir).toHaveBeenCalledOnce();
  });

  test('o pedido de um trecho dentro da estrofe oferece a estrofe inteira; o do capítulo vai sem âncora', async () => {
    const inteira: AncoraV1 = { ...ancora, fim_utf16: 12, citacao: 'Amor é fogo', sufixo: '' };
    const enviar = vi.fn(() => Promise.resolve());
    const { unmount } = render(<PainelDoVisual pedido={{ tipo: 'imagem', ancora, blocoInteiro: inteira }} poesia unidade="capítulo" aoEnviar={enviar} aoFechar={() => undefined} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Estrofe inteira' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Aquarela.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Criar imagem' })); await Promise.resolve(); });
    expect(enviar).toHaveBeenCalledWith({ alvo: { tipo: 'bloco', ancora: inteira }, pedido: 'Aquarela.' });
    unmount();
    render(<PainelDoVisual pedido={{ tipo: 'diagrama', ancora: null, blocoInteiro: null }} poesia={false} unidade="capítulo" aoEnviar={enviar} aoFechar={() => undefined} />);
    expect(screen.getByText('As ideias do capítulo inteiro, de cima para baixo.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Criar fluxograma' })); await Promise.resolve(); });
    expect(enviar).toHaveBeenLastCalledWith({ alvo: { tipo: 'capitulo' }, pedido: '' });
  });

  test('ampliado: versões, gerar de novo com pedido novo, excluir com confirmação, ir ao trecho', async () => {
    const regenerar = vi.fn(() => Promise.resolve()); const apagar = vi.fn(() => Promise.resolve()); const citar = vi.fn(); const fechar = vi.fn();
    render(<VisualAmpliado serie={{ atual: pronto, anteriores: [falhou] }} rotulo="Imagem" aoFechar={fechar} aoCitar={citar} aoRegenerar={regenerar} aoApagar={apagar} />);
    expect(screen.getByRole('dialog', { name: 'Imagem' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Um coração em chamas.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Versão 1' }));
    expect(screen.getByText('O Codex terminou sem gerar imagem.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Versão 2 (atual)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar de novo' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Óleo sobre tela.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gerar nova versão' })); await Promise.resolve(); });
    expect(regenerar).toHaveBeenCalledWith(pronto, 'Óleo sobre tela.');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir…' }));
    expect(apagar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Excluir esta versão' })); await Promise.resolve(); });
    expect(apagar).toHaveBeenCalledWith(pronto);
    fireEvent.click(screen.getByRole('button', { name: /Amor/u }));
    expect(fechar).toHaveBeenCalled();
    expect(citar).toHaveBeenCalledWith(ancora);
  });
});

test('useVisuais relê enquanto houver visual na fila e para quando todos terminam', async () => {
  const respostas = [[visual({ id: '01K0000000000000000000X005' })], [visual({ id: '01K0000000000000000000X005', estado: 'executando' })], [falhou]];
  const buscar = vi.fn(() => {
    const visuais = respostas.shift() ?? [falhou];
    return Promise.resolve(new Response(JSON.stringify({ visuais }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  vi.stubGlobal('fetch', buscar);
  const { result } = renderHook(() => useVisuais(V, S, 20));
  await waitFor(() => expect(result.current.visuais[0]?.estado).toBe('falhou'));
  const chamadas = buscar.mock.calls.length;
  await new Promise((resolver) => setTimeout(resolver, 80));
  expect(buscar.mock.calls.length).toBe(chamadas);
  expect((buscar.mock.calls as unknown as [string][])[0]?.[0]).toBe(`/api/versoes/${V}/capitulos/${S}/visuais`);
});

test('J132: fluxograma com poucos nós sai na horizontal; com muitos, continua vertical; só o cabeçalho muda', async () => {
  const { orientarFluxograma, NOS_NA_HORIZONTAL } = await import('./DiagramaMermaid');
  const curto = 'flowchart TD\n  A["Tese"] --> B["Razão"]';
  expect(orientarFluxograma(curto, 2)).toBe('flowchart LR\n  A["Tese"] --> B["Razão"]');
  expect(orientarFluxograma(curto, NOS_NA_HORIZONTAL + 1)).toBe(curto);
});
