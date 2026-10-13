import { escolherOpcao } from '../../tests/apoio-react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrepararLeitura } from './Operacoes';
import { prepararMarcas, type OpcoesDeLeitura } from './api';
import { Adicionar } from './Adicionar';
import { Lista } from './Lista';
import { Detalhe } from './Detalhe';
import type { DetalheDoDocumento } from './tipos';
import dados from '../../tests/fixtures/j18.json';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('operação de leitura', () => {
  test('modo e nível saem fora de config; 400 fica visível e padrão envia corpo vazio', async () => {
    const corpos: OpcoesDeLeitura[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, inicio?: RequestInit) => {
      if (url === '/api/modos') return Promise.resolve(json({ modos: dados.modos }));
      const corpo = JSON.parse(typeof inicio?.body === 'string' ? inicio.body : '{}') as OpcoesDeLeitura;
      corpos.push(corpo);
      return Promise.resolve(corpo.modo_de_leitura ? json({ erro: 'campo_desconhecido', detalhe: 'modo_de_leitura ainda não disponível' }, 400) : json({ execucao_id: 'execucao', partes: 1 }));
    }));
    const fechar = vi.fn();
    render(<PrepararLeitura preparar={async (opcoes) => { await prepararMarcas('documento', opcoes); }} aoFechar={fechar} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Modo de leitura' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Literária' }));

    // Não há mais escolha de nível: a preparação gera sempre as três saliências.
    expect(screen.queryByRole('combobox', { name: 'Nível da preparação' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preparar leitura escolhida' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'modo_de_leitura ainda não disponível Você pode tentar a leitura padrão.');
    expect(fechar).not.toHaveBeenCalled();
    expect(corpos[0]).toEqual({ modo_de_leitura: { id: 'literaria', revisao: 1 }, nivel_de_atencao: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Usar leitura padrão' }));
    await waitFor(() => expect(fechar).toHaveBeenCalledOnce());
    expect(corpos[1]).toEqual({});
  });
  test('upload informa poesia e faixa de páginas só nos formatos correspondentes', async () => {
    const formularios: FormData[] = [];
    const enviar = vi.fn((formulario: FormData) => { formularios.push(formulario); return Promise.resolve({ documento_id: 'doc', job_id: 'job' }); });
    render(<Adicionar ir={() => {}} enviar={enviar} servicos={{ intervalo: 60_000 }} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Poema' } });
    fireEvent.change(screen.getByLabelText('Texto', { exact: true }), { target: { value: 'Um verso\nOutro verso' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    escolherOpcao('Tipo do texto', 'Poesia');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar texto' }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(formularios[0]?.get('poesia')).toBe('1');
    expect(formularios[0]?.has('paginas')).toBe(false);
    fireEvent.change(screen.getByLabelText('Arquivo'), { target: { files: [new File(['pdf'], 'livro.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Mais opções.*livro.pdf/ }));
    expect(screen.queryByRole('combobox', { name: 'Tipo do texto' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Páginas'), { target: { value: '12-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar 1 arquivo' }));
    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(2));
    expect(formularios[1]?.get('paginas')).toBe('12-25');
    expect(formularios[1]?.has('poesia')).toBe(false);
  });
  test('filtro de arquivados continua acessível na biblioteca vazia', async () => {
    const carregar = vi.fn(() => Promise.resolve({ documentos: [] }));
    render(<Lista carregar={carregar} ir={() => {}} />);
    await screen.findByText('Nenhum texto ainda.');
    fireEvent.click(screen.getByRole('button', { name: 'Arquivados' }));
    await waitFor(() => expect(carregar).toHaveBeenLastCalledWith(true));
    expect(screen.getByText('Nenhum texto arquivado.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(carregar).toHaveBeenLastCalledWith(false));
  });
  test('arquivar e trabalhos chamam as rotas compatíveis com seus estados', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(url); return Promise.resolve(json({})); }));
    const documento: DetalheDoDocumento = {
      id: 'doc', titulo: 'Texto', autor: null, formato: 'txt', criado_em: '2026-09-24T12:00:00Z', versao_id: null, texto_disponivel: false,
      estado: 'sem_texto', detalhe: null, partes_prontas: 0, partes_total: 0, marcas: { tese: 0, conceito: 0, justificativa: 0, nenhuma: 0, total: 0 }, progresso: null, jobs_em_curso: 1, versoes: [], execucoes: [], exportacoes: [], jobs: ['fila', 'falhou', 'ok'].map((estado) => ({ id: estado, estado, tipo: 'ler_parte', attempt: 1, not_before: null, error_code: null, atualizado_em: '2026-09-24T12:00:00Z' })),
    };
    render(<Detalhe documento_id="doc" carregar={() => Promise.resolve(documento)} ir={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Opções do documento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diagnóstico' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reenfileirar' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Reenfileirar' }));
    await waitFor(() => expect(urls).toEqual(['/api/documentos/doc/arquivar', '/api/jobs/fila/cancelar', '/api/jobs/falhou/reenfileirar']));
  });
});
