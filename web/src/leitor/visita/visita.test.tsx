// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AncoraV1, RoteiroGuiadoV1 } from '@margem/contratos';
import type { ApiDoLeitor } from '../tipos';
import type { MarcaDoLeitor } from '../f2';
import { VisitaGuiada, formatarTempo, type FocoDaVisita } from './VisitaGuiada';
import { consumirContinuacao, lerPonto } from './retomada';
import { useVisita, type FontesDaVisita } from './useVisita';

const id = (n: number): string => String(n).padStart(26, '0');
const V = id(20);
const blocos = [
  { id: id(1), texto: 'Capítulo um' },
  { id: id(2), texto: 'Admitamos inicialmente que os preços são rígidos.' },
  { id: id(3), texto: 'Logo, somente com preços rígidos o produto cai.' },
];
const ancora = (bloco: number, citacao: string): AncoraV1 => {
  const texto = blocos[bloco - 1]!.texto;
  const inicio = texto.indexOf(citacao);
  return { versao_id: V, bloco_id: id(bloco), inicio_utf16: inicio, fim_utf16: inicio + citacao.length, citacao, prefixo: '', sufixo: '' };
};

function roteiro(): RoteiroGuiadoV1 {
  const parada = (ordem: number, tipo: RoteiroGuiadoV1['paradas'][number]['tipo'], bloco: number, citacao: string, ponta: AncoraV1 | null) => ({
    ordem, tipo, titulo: `Parada ${String(ordem)}`, bloco_inicio: id(bloco), bloco_fim: id(bloco), foco: ancora(bloco, citacao), ponta,
    elementos: [id(100 + ordem)], relacoes: ponta ? [id(201)] : [], dificuldades: [], anotacoes: [], visuais: [], pergunta: ponta ? 'E se fossem flexíveis?' : null,
  });
  return {
    versao: 1, id: id(300), execucao_id: id(40), versao_id: V, secao_id: id(60), modelo_id: id(50), perfil_hash: 'p',
    capitulo: { titulo: 'Capítulo um', numero: 1, total: 2 },
    paradas: [parada(1, 'conceito', 2, 'Admitamos inicialmente', null), parada(2, 'retorno', 3, 'somente com preços rígidos', ancora(2, 'Admitamos inicialmente'))],
    falas: [
      { id: 'f001', papel: 'abertura', parada: null, texto: 'Começamos. O capítulo fixa uma hipótese.' },
      { id: 'f002', papel: 'parada', parada: 1, texto: 'Repare no inicialmente.' },
      { id: 'f003', papel: 'transicao', parada: 1, texto: 'Agora, a conclusão.' },
      { id: 'f004', papel: 'parada', parada: 2, texto: 'A hipótese volta aqui.' },
      { id: 'f005', papel: 'fechamento', parada: null, texto: 'Ficou a hipótese.' },
      { id: 'f006', papel: 'ponte', parada: null, texto: 'No próximo, outro assunto.' },
    ],
    perguntas_finais: ['Por que inicial?'], proxima_secao_id: id(61), diagnosticos: [],
    execucao: { modelo: 'm', esforco: 'medium', prompt: 'roteirizar-visita@1' }, job_id: id(90), criado_em: '2026-09-29T23:00:00.000Z',
  };
}

function leitorFalso(): { current: ApiDoLeitor } {
  const posicao: Record<string, [number, number]> = { [id(1)]: [40, 30], [id(2)]: [100, 60], [id(3)]: [400, 30] };
  return { current: { localizar: () => null, ancoraVisivel: () => null,
    retangulosDaAncora: (a) => { const [topo, altura] = posicao[a.bloco_id] ?? [0, 0]; return [{ top: topo, bottom: topo + altura, left: 400, right: 1100, width: 700, height: altura, x: 400, y: topo, toJSON: () => ({}) }]; } } };
}

beforeEach(() => { window.scrollBy = vi.fn(); Element.prototype.scrollTo = vi.fn(); window.matchMedia = vi.fn().mockReturnValue({ matches: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); try { localStorage.clear(); sessionStorage.clear(); } catch { /* sem storage */ } });

test('a visita começa na abertura, anda de parada em parada com o foco e a ponta, e guarda onde parou', () => {
  const focos: (FocoDaVisita | null)[] = [];
  const marcas = [{ id: 'm1', ancora: ancora(2, 'Admitamos inicialmente') }, { id: 'm2', ancora: ancora(3, 'somente com preços rígidos') }] as unknown as MarcaDoLeitor[];
  const aoCitar = vi.fn();
  const { container } = render(<VisitaGuiada roteiro={roteiro()} narracao={null} modelo={null} documentoId="doc" versaoId={V} blocos={blocos} leitor={leitorFalso()}
    marcas={marcas} aoSair={() => undefined} aoCitar={aoCitar} aoMudarFoco={(foco) => focos.push(foco)} />);
  expect(screen.getByText('Visita guiada · Cap. 1 de 2')).toBeDefined();
  expect(screen.getByText('Abertura')).toBeDefined();
  expect(screen.getByText('sem voz · ritmo de leitura')).toBeDefined();
  expect(container.querySelector('.veu-guiado')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Próxima parada' }));
  expect(screen.getByText('Parada 1 de 2 · Conceito')).toBeDefined();
  expect(screen.getByText('Repare no inicialmente.')).toBeDefined();
  // Sem véu e sem caixa: o foco é só o grifo aceso (decisão de produto, 30/09).
  expect(focos.at(-1)).toMatchObject({ marcas: ['m1'], ativa: 'm1', ancora: null });
  expect(container.querySelector('.veu-guiado')).toBeNull();

  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('Parada 2 de 2 · Relação que volta')).toBeDefined();
  expect(screen.getByText('E se fossem flexíveis?')).toBeDefined();
  expect(container.querySelector('.veu-guiado')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Volta a/ }));
  expect(aoCitar).toHaveBeenCalledWith(expect.objectContaining({ bloco_id: id(2) }));
  expect(lerPonto('doc')).toMatchObject({ secao_id: id(60), roteiro_id: id(300) });
  expect(lerPonto('doc')!.t).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: 'Ler o trecho inteiro' }));
  expect(screen.getByRole('button', { name: 'Voltar à visita' })).toBeDefined();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('Fechamento')).toBeDefined();
  expect(screen.getByText('Por que inicial?')).toBeDefined();
});

test('tocar sem voz anda no ritmo de leitura; ao fim da ponte, segue para o próximo capítulo tocando', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
  const aoIrCapitulo = vi.fn();
  render(<VisitaGuiada roteiro={roteiro()} narracao={null} modelo={null} documentoId="doc" versaoId={V} blocos={blocos} leitor={leitorFalso()}
    aoSair={() => undefined} aoCitar={() => undefined} aoIrCapitulo={aoIrCapitulo} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tocar' }));
  expect(screen.getByRole('button', { name: 'Pausar' })).toBeDefined();
  act(() => { vi.advanceTimersByTime(4000); });
  expect(screen.getByText(/^Parada 1 de 2/)).toBeDefined();
  act(() => { vi.advanceTimersByTime(20_000); });
  expect(aoIrCapitulo).toHaveBeenCalledWith(id(61));
  expect(consumirContinuacao('doc', id(61))).toBe(true);
});

test('pular capítulo e sair pelo teclado', () => {
  const aoIrCapitulo = vi.fn();
  const aoSair = vi.fn();
  render(<VisitaGuiada roteiro={roteiro()} narracao={null} modelo={null} documentoId="doc" versaoId={V} blocos={blocos} leitor={leitorFalso()}
    aoSair={aoSair} aoCitar={() => undefined} aoIrCapitulo={aoIrCapitulo} />);
  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
  expect(aoIrCapitulo).toHaveBeenCalledWith(id(61));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(aoSair).toHaveBeenCalled();
  expect(formatarTempo(125.4)).toBe('2:05');
});

test('useVisita consulta até ficar pronta e prepara num pedido explícito', async () => {
  const detalhe = vi.fn<FontesDaVisita['detalhe']>()
    .mockResolvedValueOnce({ estado: 'nao_preparada', roteiro: null, narracao: null })
    .mockResolvedValue({ estado: 'pronta', roteiro: roteiro(), narracao: null });
  const preparar = vi.fn<FontesDaVisita['preparar']>().mockResolvedValue({ estado: 'preparando', roteiro: null, narracao: null });
  const fontes = { detalhe, preparar };
  const { result } = renderHook(() => useVisita('exec', 'sec', fontes, 10));
  await waitFor(() => expect(result.current.estado).toBe('nao_preparada'));
  expect(preparar).not.toHaveBeenCalled();
  act(() => result.current.preparar());
  await waitFor(() => expect(result.current.estado).toBe('pronta'));
  expect(preparar).toHaveBeenCalledWith('exec', 'sec');
  expect(result.current.roteiro?.id).toBe(id(300));
});
