import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { armazemEmMemoria } from './armazem';
import { BoasVindas } from './BoasVindas';
import { ProvedorDoOnboarding, usarOnboarding } from './ContextoDoOnboarding';
import { DicaAncorada } from './DicaAncorada';
import { ONBOARDING_INICIAL, reduzirOnboarding } from './estado';
import type { FontesDoExemplo } from './exemplo';
import { LevarConsigo } from './LevarConsigo';
import { PrimeiroDocumento } from './PrimeiroDocumento';
import { TourDoLeitor, TourDoPlayer, TourDoQuadro } from './TourDoLeitor';
import { PrimeirosPassos } from './PrimeirosPassos';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const nunca = () => Promise.resolve(false);

function Mostrador() {
  const { estado } = usarOnboarding();
  return <output data-testid="estado">{JSON.stringify(estado)}</output>;
}
const lerEstado = () => JSON.parse(screen.getByTestId('estado').textContent ?? '{}') as typeof ONBOARDING_INICIAL;

describe('boas-vindas', () => {
  test('quatro telas que citam ler, assistir e observar, com foco no título a cada troca e o progresso gravado', () => {
    const armazem = armazemEmMemoria();
    render(<ProvedorDoOnboarding armazem={armazem} verificarUsoAnterior={nunca}><BoasVindas ir={() => {}} quadros={() => Promise.resolve({ obras: [] })} /><Mostrador /></ProvedorDoOnboarding>);
    expect(screen.getByRole('dialog', { name: 'Boas-vindas ao Margem' })).toBeDefined();
    expect(screen.getByText(/lê, assiste e observa/)).toBeDefined();
    expect(screen.getByText('Primeiros passos · 1 de 4')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    expect(screen.getByRole('heading', { name: 'Três jeitos de estudar' })).toBe(document.activeElement);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Ler', 'Assistir', 'Observar']);
    expect(armazem.atual?.tela).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    expect(screen.getByRole('heading', { name: 'Como se lê no Margem' })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    expect(screen.getByRole('heading', { name: 'Comece por um exemplo' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Ler um texto de exemplo/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Assistir a um vídeo do YouTube/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(lerEstado().tela).toBe(2);
  });

  test('Esc pula e lembra; nada é gravado antes da primeira ação', () => {
    const armazem = armazemEmMemoria();
    render(<ProvedorDoOnboarding armazem={armazem} verificarUsoAnterior={nunca}><BoasVindas ir={() => {}} /><Mostrador /></ProvedorDoOnboarding>);
    expect(armazem.atual).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(lerEstado().boas_vindas).toBe('pulada');
    expect(armazem.atual?.boas_vindas).toBe('pulada');
  });

  test('retoma na tela em que a pessoa parou', () => {
    const armazem = armazemEmMemoria(reduzirOnboarding(ONBOARDING_INICIAL, { tipo: 'avancar_tela' }, '2026-10-01T00:00:00Z'));
    render(<ProvedorDoOnboarding armazem={armazem}><BoasVindas ir={() => {}} /></ProvedorDoOnboarding>);
    expect(screen.getByRole('heading', { name: 'Três jeitos de estudar' })).toBeDefined();
  });

  test('as portas fecham as boas-vindas e levam à aba certa de Adicionar, ou ao quadro de exemplo sem custo', async () => {
    const ir = vi.fn();
    const naUltima = [0, 1, 2].reduce((e) => reduzirOnboarding(e, { tipo: 'avancar_tela' }, '2026-10-01T00:00:00Z'), ONBOARDING_INICIAL);
    const quadros = () => Promise.resolve({ obras: [{ slug: 'aula-de-danca', titulo: 'A aula de dança', artista: 'Edgar Degas', exemplo: true } as never] });
    const { unmount } = render(<ProvedorDoOnboarding armazem={armazemEmMemoria(naUltima)}><BoasVindas ir={ir} quadros={quadros} /><Mostrador /></ProvedorDoOnboarding>);
    fireEvent.click(screen.getByRole('button', { name: /Trazer o seu/ }));
    expect(ir).toHaveBeenLastCalledWith({ nome: 'adicionar', aba: 'documento' });
    expect(lerEstado().boas_vindas).toBe('concluida');
    unmount();
    render(<ProvedorDoOnboarding armazem={armazemEmMemoria(naUltima)}><BoasVindas ir={ir} quadros={quadros} /></ProvedorDoOnboarding>);
    fireEvent.click(await screen.findByRole('button', { name: /Observar um quadro de exemplo.*A aula de dança.*Edgar Degas/ }));
    expect(ir).toHaveBeenLastCalledWith({ nome: 'quadro', slug: 'aula-de-danca' });
    fireEvent.click(screen.getByRole('button', { name: /Assistir a um vídeo/ }));
    expect(ir).toHaveBeenLastCalledWith({ nome: 'adicionar', aba: 'video' });
  });
});

describe('provedor', () => {
  test('quem já tinha textos não vê as boas-vindas', async () => {
    const armazem = armazemEmMemoria();
    render(<ProvedorDoOnboarding armazem={armazem} verificarUsoAnterior={() => Promise.resolve(true)}><Mostrador /></ProvedorDoOnboarding>);
    await waitFor(() => expect(lerEstado().boas_vindas).toBe('pulada'));
    expect(armazem.atual?.primeiro_documento.origem).toBe('uso_anterior');
  });

  test('fora do provedor nada do onboarding aparece', () => {
    render(<TourDoLeitor situacao="com_marcas" pdf={false} ir={() => {}} atrasoMs={0} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('primeiro documento: o exemplo', () => {
  test('adiciona, mostra a preparação com honestidade e abre no leitor quando o texto fica pronto', async () => {
    const ir = vi.fn();
    let consultas = 0;
    const fontes: FontesDoExemplo = {
      texto: () => Promise.resolve('# Um apólogo\n\nEra uma vez.'),
      enviar: () => Promise.resolve({ documento_id: 'EXEMPLO1' }),
      documento: (id) => Promise.resolve({ id, estado: consultas++ < 1 ? 'canonizando' : 'pronto', texto_disponivel: consultas > 1 }),
    };
    const armazem = armazemEmMemoria();
    render(<ProvedorDoOnboarding armazem={armazem} verificarUsoAnterior={nunca}><PrimeiroDocumento ir={ir} fontes={fontes} /></ProvedorDoOnboarding>);
    fireEvent.click(screen.getByRole('button', { name: /Ler um texto de exemplo/ }));
    expect((await screen.findAllByText(/Preparando o texto/)).length).toBeGreaterThan(0);
    expect(armazem.atual?.exemplo_id).toBe('EXEMPLO1');
    await waitFor(() => expect(ir).toHaveBeenCalledWith({ nome: 'leitura', documento_id: 'EXEMPLO1' }), { timeout: 4000 });
  });
});

describe('dica ancorada', () => {
  test('é um diálogo não modal, foca o botão principal, circula o Tab e responde a setas e Esc', () => {
    const alvo = document.createElement('button');
    alvo.className = 'alvo'; alvo.textContent = 'alvo';
    document.body.append(alvo); alvo.focus();
    const avancar = vi.fn(); const voltar = vi.fn(); const fechar = vi.fn();
    const { unmount } = render(<DicaAncorada alvos={['.alvo']} titulo="Notas na margem" passo={1} total={5} aoAvancar={avancar} aoVoltar={voltar} aoFechar={fechar}><p>Texto da dica</p></DicaAncorada>);
    const dialogo = screen.getByRole('dialog', { name: 'Notas na margem' });
    expect(dialogo.getAttribute('aria-modal')).toBe('false');
    expect(dialogo.getAttribute('aria-describedby')).toBeTruthy();
    const proxima = screen.getByRole('button', { name: 'Próxima' });
    expect(document.activeElement).toBe(proxima);
    fireEvent.keyDown(proxima, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar as dicas' }));
    fireEvent.keyDown(dialogo, { key: 'ArrowRight' });
    fireEvent.keyDown(dialogo, { key: 'ArrowLeft' });
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    expect([avancar.mock.calls.length, voltar.mock.calls.length, fechar.mock.calls.length]).toEqual([1, 1, 1]);
    unmount();
    expect(document.activeElement).toBe(alvo);
    alvo.remove();
  });
});

describe('tour do leitor', () => {
  const comBoasVindasVistas = () => armazemEmMemoria(reduzirOnboarding(ONBOARDING_INICIAL, { tipo: 'concluir_boas_vindas' }, '2026-10-01T00:00:00Z'));

  test('percorre as cinco dicas e grava a conclusão', () => {
    const armazem = comBoasVindasVistas();
    render(<ProvedorDoOnboarding armazem={armazem}><TourDoLeitor situacao="com_marcas" pdf={false} ir={() => {}} atrasoMs={0} /></ProvedorDoOnboarding>);
    const titulos: string[] = [];
    for (let i = 0; i < 5; i++) {
      titulos.push(screen.getByRole('dialog').getAttribute('aria-labelledby') ? screen.getByRole('heading', { level: 2 }).textContent ?? '' : '');
      fireEvent.click(screen.getByRole('button', { name: i === 4 ? 'Concluir' : 'Próxima' }));
    }
    expect(titulos).toEqual(['As cores dizem a função', 'Notas na margem', 'Do seu jeito', 'Pergunte ao texto', 'Retome de onde parou']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(armazem.atual?.tours).toEqual({ texto: 'concluida', video: 'pendente', quadro: 'pendente' });
  });

  test('V-D4: o vídeo e o quadro têm o seu tour, que pode ser pulado sem mexer nos outros', () => {
    const armazem = comBoasVindasVistas();
    const { unmount } = render(<ProvedorDoOnboarding armazem={armazem}><TourDoPlayer video ir={() => {}} atrasoMs={0} /></ProvedorDoOnboarding>);
    expect(screen.getByRole('heading', { name: 'A transcrição acompanha' })).toBeDefined();
    expect(screen.getByText(/Clique numa frase/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getByRole('heading', { name: 'Marque e pergunte como num texto' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(armazem.atual?.tours.video).toBe('concluida');
    unmount();
    render(<ProvedorDoOnboarding armazem={armazem}><TourDoQuadro ir={() => {}} atrasoMs={0} /></ProvedorDoOnboarding>);
    expect(screen.getByRole('heading', { name: 'Percorra a obra' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar as dicas' }));
    expect(armazem.atual?.tours).toEqual({ texto: 'pendente', video: 'concluida', quadro: 'pulada' });
  });

  test('sem marcas, a primeira dica diz como pedi-las em vez de prometê-las', () => {
    render(<ProvedorDoOnboarding armazem={comBoasVindasVistas()}><TourDoLeitor situacao="sem_marcas" pdf={false} ir={() => {}} atrasoMs={0} /></ProvedorDoOnboarding>);
    expect(screen.getByText(/ainda não tem marcas/)).toBeDefined();
  });

  test('não aparece enquanto as boas-vindas estão pendentes e espera o leitor assentar', () => {
    vi.useFakeTimers();
    const { unmount } = render(<ProvedorDoOnboarding armazem={armazemEmMemoria(ONBOARDING_INICIAL)}><TourDoLeitor situacao="com_marcas" pdf={false} ir={() => {}} atrasoMs={0} /></ProvedorDoOnboarding>);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    render(<ProvedorDoOnboarding armazem={comBoasVindasVistas()}><TourDoLeitor situacao="lendo" pdf={false} ir={() => {}} atrasoMs={500} /></ProvedorDoOnboarding>);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByText(/está lendo este texto agora/)).toBeDefined();
  });
});

describe('primeiros passos e leve com você', () => {
  test('mostra o progresso e reabre as boas-vindas', () => {
    const armazem = armazemEmMemoria(reduzirOnboarding(ONBOARDING_INICIAL, { tipo: 'pular_boas_vindas' }, '2026-10-01T00:00:00Z'));
    render(<ProvedorDoOnboarding armazem={armazem}><PrimeirosPassos ir={() => {}} /></ProvedorDoOnboarding>);
    expect(screen.getByText('0 de 6 feitos')).toBeDefined();
    expect(screen.getByText('Dicas do vídeo')).toBeDefined();
    expect(screen.getByText('Dicas do quadro')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Rever' }));
    expect(armazem.atual?.boas_vindas).toBe('pendente');
  });

  test('no iPhone, explica o "Adicionar à Tela de Início"; extensão e Obsidian levam à ajuda interna', () => {
    const ir = vi.fn();
    render(<ProvedorDoOnboarding armazem={armazemEmMemoria()} verificarUsoAnterior={nunca}><LevarConsigo ir={ir} como="ios" /></ProvedorDoOnboarding>);
    expect(screen.getByText('Adicionar à Tela de Início')).toBeDefined();
    expect(screen.queryByText('Em breve')).toBeNull();
    fireEvent.click(screen.getAllByRole('link', { name: 'Saiba mais' })[1]!);
    expect(ir).toHaveBeenCalledWith({ nome: 'ajuda', pagina: 'obsidian' });
  });
});
