import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { capituloExemplo } from '../leitor/fixtures/capitulo-exemplo';
import { ErroDaApi } from './api';
import { Ler, capituloInicial, type FontesDaLeitura } from './Ler';
import { LimiteDeErro } from '../ui/LimiteDeErro';
import type { Rota } from './rotas';
import type { ArvoreDaVersao, DetalheDoDocumento, ProgressoPersistido, SnapshotDoCapitulo } from './tipos';

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('scrollBy', () => undefined); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

const DOCUMENTO = '0'.repeat(25) + '1';
const versaoId = capituloExemplo.versao_id;
const CAP = ['0'.repeat(25) + '7', '0'.repeat(25) + '8', '0'.repeat(25) + '9'] as const;
const arvore: ArvoreDaVersao = {
  versao_id: versaoId, documento_id: DOCUMENTO, titulo: 'Livro de teste', secoes: [], limites: [],
  capitulos: CAP.map((id, i) => ({ id, titulo: `Capítulo ${String(i + 1)}` })),
};
const documento = { id: DOCUMENTO, titulo: 'Livro de teste', autor: null, formato: 'md', estado: 'pronto', versao_id: versaoId, versoes: [], execucoes: [], jobs: [], exportacoes: [] } as unknown as DetalheDoDocumento;
function snapshotDe(secao: string): SnapshotDoCapitulo {
  return { ...capituloExemplo, documento_id: DOCUMENTO, revisao_marcas: 'a'.repeat(64), secao: { ...capituloExemplo.secao, id: secao }, anterior: null, proxima: null } as SnapshotDoCapitulo;
}
function progressoEm(versao: string, bloco: string, concluidos: string[] = []): ProgressoPersistido {
  return { documento_id: DOCUMENTO, versao_id: versao, revisao: 3, capitulos_concluidos: concluidos, atualizado_em: '2026-10-15T12:00:00Z',
    ancora: { versao_id: versao, bloco_id: bloco, inicio_utf16: 0, fim_utf16: 1, citacao: 'x', prefixo: '', sufixo: '' } };
}
function fontes(progresso: ProgressoPersistido | null, capituloDoBloco: Record<string, string>, registro: { blocos: (string | undefined)[]; capitulos: string[] }): FontesDaLeitura {
  return {
    documento: () => Promise.resolve(documento),
    arvore: (_versao, bloco) => { registro.blocos.push(bloco); return Promise.resolve(bloco ? { ...arvore, capitulo_do_bloco: capituloDoBloco[bloco] ?? null } : arvore); },
    capitulo: (_versao, secao) => { registro.capitulos.push(secao); return Promise.resolve(snapshotDe(secao)); },
    progresso: () => Promise.resolve({ progresso }),
    gravarProgresso: () => Promise.resolve({ estado: 'erro' as const }),
    marca: () => Promise.resolve(null),
  };
}

describe('I-04: reabrir pela biblioteca volta ao capítulo da posição salva', () => {
  test('capituloInicial: pedido, depois o da âncora, depois o primeiro não concluído', () => {
    expect(capituloInicial({ ...arvore, capitulo_do_bloco: CAP[2] }, CAP[0], null)).toBe(CAP[0]);
    expect(capituloInicial({ ...arvore, capitulo_do_bloco: CAP[2] }, undefined, null)).toBe(CAP[2]);
    expect(capituloInicial({ ...arvore, capitulo_do_bloco: null }, undefined, progressoEm(versaoId, 'B', [CAP[0]]))).toBe(CAP[1]);
    expect(capituloInicial({ ...arvore, capitulo_do_bloco: 'OUTRO' }, undefined, null)).toBe(CAP[0]);
  });

  test('R3-2: um capítulo que o sumário sugerido escondeu abre quando pedido por link; um id qualquer não', () => {
    const OCULTO = '0'.repeat(25) + '6';
    expect(capituloInicial({ ...arvore, capitulos_ocultos: [OCULTO] }, OCULTO, null)).toBe(OCULTO);
    expect(capituloInicial(arvore, OCULTO, null)).toBe(CAP[0]);
  });

  test('posição no capítulo 3 sem os anteriores concluídos: abre o 3', async () => {
    const registro = { blocos: [] as (string | undefined)[], capitulos: [] as string[] };
    const destinos: Rota[] = [];
    render(<Ler documento_id={DOCUMENTO} ir={(destino) => destinos.push(destino)} fontes={fontes(progressoEm(versaoId, 'BLOCO-DO-CAP-3'), { 'BLOCO-DO-CAP-3': CAP[2] }, registro)} />);
    await waitFor(() => expect(destinos[0]).toEqual({ nome: 'leitura', documento_id: DOCUMENTO, secao_id: CAP[2] }));
    expect(registro.blocos).toEqual(['BLOCO-DO-CAP-3']);
    expect(registro.capitulos).toEqual([CAP[2]]);
  });

  test('posição de outra versão: não serve; abre o primeiro não concluído', async () => {
    const registro = { blocos: [] as (string | undefined)[], capitulos: [] as string[] };
    const destinos: Rota[] = [];
    render(<Ler documento_id={DOCUMENTO} ir={(destino) => destinos.push(destino)}
      fontes={fontes(progressoEm('V'.repeat(26), 'BLOCO-DO-CAP-3', [CAP[0]]), { 'BLOCO-DO-CAP-3': CAP[2] }, registro)} />);
    await waitFor(() => expect(destinos[0]).toEqual({ nome: 'leitura', documento_id: DOCUMENTO, secao_id: CAP[1] }));
    expect(registro.blocos).toEqual([undefined]);
  });

  test('com capítulo pedido na URL, a posição salva não manda', async () => {
    const registro = { blocos: [] as (string | undefined)[], capitulos: [] as string[] };
    render(<Ler documento_id={DOCUMENTO} secao_id={CAP[0]} ir={() => undefined} fontes={fontes(progressoEm(versaoId, 'BLOCO-DO-CAP-3'), { 'BLOCO-DO-CAP-3': CAP[2] }, registro)} />);
    await waitFor(() => expect(registro.capitulos).toEqual([CAP[0]]));
    expect(registro.blocos).toEqual([undefined]);
  });
});

describe('U-04: erro ao abrir a leitura', () => {
  test('sem "falha_interna" na tela; Tentar novamente reabre e Voltar à biblioteca sai', async () => {
    const registro = { blocos: [] as (string | undefined)[], capitulos: [] as string[] };
    const base = fontes(null, {}, registro);
    const capitulo = vi.fn<FontesDaLeitura['capitulo']>()
      .mockRejectedValueOnce(new ErroDaApi(500, 'falha_interna'))
      .mockImplementation((_versao, secao) => Promise.resolve(snapshotDe(secao)));
    const destinos: Rota[] = [];
    const { container } = render(<Ler documento_id={DOCUMENTO} secao_id={CAP[0]} ir={(destino) => destinos.push(destino)} fontes={{ ...base, capitulo }} />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível abrir a leitura');
    expect(alerta.textContent).not.toMatch(/falha_interna|failed|error/i);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar à biblioteca' }));
    expect(destinos.at(-1)).toEqual({ nome: 'biblioteca' });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(container.querySelector('.leitor')).not.toBeNull());
    expect(capitulo).toHaveBeenCalledTimes(2);
  });

  test('conexão recusada: frase de conexão, sem a mensagem do navegador', async () => {
    const base = fontes(null, {}, { blocos: [], capitulos: [] });
    render(<Ler documento_id={DOCUMENTO} ir={() => undefined} fontes={{ ...base, documento: () => Promise.reject(new TypeError('Failed to fetch')) }} />);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/Não foi possível falar com o Margem/);
    expect(alerta.textContent).not.toMatch(/Failed to fetch/);
  });
});

describe('I-08: limite de erro', () => {
  function Quebra({ quebrar }: { quebrar: () => boolean }): ReactNode {
    if (quebrar()) throw new Error('render quebrou');
    return <p>Tudo certo</p>;
  }
  test('uma exceção ao desenhar vira mensagem com Tentar novamente e Voltar à biblioteca', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let quebrado = true;
    const voltar = vi.fn();
    const tentar = vi.fn(() => { quebrado = false; });
    render(<LimiteDeErro aoTentar={tentar} aoVoltar={voltar}><Quebra quebrar={() => quebrado} /></LimiteDeErro>);
    expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível mostrar esta parte do Margem/);
    expect(screen.getByRole('alert').textContent).not.toMatch(/render quebrou/);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(tentar).toHaveBeenCalled();
    expect(screen.getByText('Tudo certo')).toBeDefined();
    quebrado = true;
    cleanup();
    render(<LimiteDeErro aoVoltar={voltar}><Quebra quebrar={() => quebrado} /></LimiteDeErro>);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar à biblioteca' }));
    expect(voltar).toHaveBeenCalled();
  });
});
