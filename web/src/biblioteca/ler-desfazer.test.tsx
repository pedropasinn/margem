import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { capituloExemplo } from '../leitor/fixtures/capitulo-exemplo';
import { usePilhaDeDesfazer } from '../leitor/desfazer';
import { LimiteDeErro } from '../ui/LimiteDeErro';
import { Ler, type FontesDaLeitura } from './Ler';
import type { Rota } from './rotas';
import type { ArvoreDaVersao, DetalheDoDocumento, SnapshotDoCapitulo } from './tipos';

// R-07: o controlador de verdade é pesado; este dublê usa a mesma pilha de desfazer e mostra o capítulo.
const desfazerGrifo = vi.fn<() => void>();
const montagens = vi.fn<() => void>();
vi.mock('../leitor/ReaderController', async (original) => ({
  ...await original<typeof import('../leitor/ReaderController')>(),
  ReaderController: function Dublê({ snapshot }: { snapshot: SnapshotDoCapitulo }): ReactNode {
    const pilha = usePilhaDeDesfazer();
    useState(() => { montagens(); return null; });
    return <div>
      <p>Capítulo aberto: {snapshot.secao.id}</p>
      <button onClick={() => { pilha.registrar({ rotulo: 'Grifo apagado', desfazer: desfazerGrifo }); }}>Apagar grifo</button>
      <button onClick={() => { void pilha.desfazer(); }}>Desfazer</button>
    </div>;
  },
}));

beforeEach(() => { vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('scrollBy', () => undefined); window.localStorage.clear(); desfazerGrifo.mockClear(); montagens.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const DOCUMENTO = '0'.repeat(25) + '1';
const versaoId = capituloExemplo.versao_id;
const CAP = ['0'.repeat(25) + '7', '0'.repeat(25) + '8'] as const;
const arvore: ArvoreDaVersao = {
  versao_id: versaoId, documento_id: DOCUMENTO, titulo: 'Livro de teste', secoes: [], limites: [],
  capitulos: CAP.map((id, i) => ({ id, titulo: `Capítulo ${String(i + 1)}` })),
};
const documento = { id: DOCUMENTO, titulo: 'Livro de teste', autor: null, formato: 'md', estado: 'pronto', versao_id: versaoId, versoes: [], execucoes: [], jobs: [], exportacoes: [] } as unknown as DetalheDoDocumento;
const fontes: FontesDaLeitura = {
  documento: () => Promise.resolve(documento),
  arvore: () => Promise.resolve(arvore),
  capitulo: (_versao, secao) => Promise.resolve({ ...capituloExemplo, documento_id: DOCUMENTO, revisao_marcas: 'a'.repeat(64),
    secao: { ...capituloExemplo.secao, id: secao }, anterior: null, proxima: null } as SnapshotDoCapitulo),
  progresso: () => Promise.resolve({ progresso: null }),
  gravarProgresso: () => Promise.resolve({ estado: 'erro' as const }),
  marca: () => Promise.resolve(null),
};

function Roteador(): ReactNode {
  const [secao, definirSecao] = useState<string>(CAP[0]);
  const ir = (destino: Rota) => { if (destino.nome === 'leitura' && destino.secao_id) definirSecao(destino.secao_id); };
  return <>
    <button onClick={() => { definirSecao(secao === CAP[0] ? CAP[1] : CAP[0]); }}>Trocar capítulo</button>
    <Ler documento_id={DOCUMENTO} secao_id={secao} ir={ir} fontes={fontes} />
  </>;
}

test('R-07: apagar grifo, trocar de capítulo e voltar: o desfazer ainda funciona', async () => {
  render(<Roteador />);
  await screen.findByText(`Capítulo aberto: ${CAP[0]}`);
  fireEvent.click(screen.getByRole('button', { name: 'Apagar grifo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trocar capítulo' }));
  await screen.findByText(`Capítulo aberto: ${CAP[1]}`);
  fireEvent.click(screen.getByRole('button', { name: 'Trocar capítulo' }));
  await screen.findByText(`Capítulo aberto: ${CAP[0]}`);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Desfazer' })); await Promise.resolve(); });
  expect(desfazerGrifo).toHaveBeenCalledTimes(1);
  expect(montagens).toHaveBeenCalledTimes(1);
});

test('R-07: o limite esquece a falha quando resetKey muda, sem precisar de key', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let quebrar = true;
  function Parte(): ReactNode { if (quebrar) throw new Error('render quebrou'); return <p>Tudo certo</p>; }
  const { rerender } = render(<LimiteDeErro resetKey="a"><Parte /></LimiteDeErro>);
  expect(screen.getByRole('alert')).toBeDefined();
  quebrar = false;
  rerender(<LimiteDeErro resetKey="a"><Parte /></LimiteDeErro>);
  expect(screen.getByRole('alert')).toBeDefined();
  rerender(<LimiteDeErro resetKey="b"><Parte /></LimiteDeErro>);
  expect(screen.getByText('Tudo certo')).toBeDefined();
  vi.restoreAllMocks();
});
