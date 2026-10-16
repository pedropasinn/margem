/**
 * Configurações → Modelos (V-T10): para cada tipo de tarefa do Codex, o modelo e o esforço.
 * "Padrão do Margem" é o que o Margem já usa (a linha "Padrão: …" explica qual); a lista de modelos é a
 * da conta da pessoa, lida pelo próprio Codex, e "Outro…" aceita um nome digitado.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { mensagemDeErro } from '../biblioteca/erros';
import { Button, Input, Select } from '../ui/Primitives';
import {
  atualizarListaDeModelos, gravarEscolhaDeModelo, lerConfiguracaoDosModelos,
  type CategoriaDeExecucao, type ConfiguracaoDosModelos, type EscolhaDaCategoria, type Esforco,
} from './api';
import './modelos.css';

const PADRAO = '';
const OUTRO = '__outro';

export interface FontesDosModelos {
  ler: typeof lerConfiguracaoDosModelos;
  gravar: typeof gravarEscolhaDeModelo;
  atualizar: typeof atualizarListaDeModelos;
}
const FONTES: FontesDosModelos = { ler: lerConfiguracaoDosModelos, gravar: gravarEscolhaDeModelo, atualizar: atualizarListaDeModelos };

const mensagem = mensagemDeErro;

function quando(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ModelosNasConfiguracoes({ fontes = FONTES }: { fontes?: FontesDosModelos }): ReactNode {
  const [config, definirConfig] = useState<ConfiguracaoDosModelos | null>(null);
  const [falha, definirFalha] = useState<string | null>(null);
  const [aviso, avisar] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, ocupar] = useState<string | null>(null);

  useEffect(() => { fontes.ler().then(definirConfig, (e: unknown) => definirFalha(mensagem(e, 'Não foi possível ler os modelos.'))); }, [fontes]);

  const gravar = async (categoria: CategoriaDeExecucao, escolha: EscolhaDaCategoria): Promise<boolean> => {
    ocupar(categoria.id); avisar(null);
    try {
      definirConfig(await fontes.gravar(categoria.id, escolha));
      avisar({ tipo: 'ok', texto: `${categoria.rotulo}: salvo. Vale a partir da próxima tarefa.` });
      return true;
    } catch (e) {
      avisar({ tipo: 'erro', texto: mensagem(e, 'Não foi possível salvar a escolha.') });
      return false;
    } finally { ocupar(null); }
  };
  const atualizar = async () => {
    ocupar('lista'); avisar(null);
    try { definirConfig(await fontes.atualizar()); avisar({ tipo: 'ok', texto: 'Lista de modelos atualizada.' }); }
    catch (e) { avisar({ tipo: 'erro', texto: mensagem(e, 'Não foi possível atualizar a lista de modelos.') }); }
    finally { ocupar(null); }
  };

  const cabeca = <div className="cabeca-da-secao">
    <h2 id="titulo-dos-modelos">Modelos</h2>
    <p className="secundario">Escolha o modelo do Codex e o esforço de cada tipo de tarefa. Mais esforço pensa mais e demora mais; “Padrão do Margem” segue o que o Margem já usa.</p>
  </div>;
  if (falha) return <section className="card configuracao-dos-modelos" aria-labelledby="titulo-dos-modelos">{cabeca}<p className="aviso">{falha}</p></section>;
  if (!config) return <section className="card configuracao-dos-modelos" aria-labelledby="titulo-dos-modelos" aria-busy="true">{cabeca}</section>;
  const { catalogo } = config;

  return <section className="card configuracao-dos-modelos" id="modelos" aria-labelledby="titulo-dos-modelos">
    {cabeca}
    <ul className="categorias-de-modelo">
      {config.categorias.map((categoria) => <LinhaDaCategoria key={categoria.id} categoria={categoria} config={config} ocupado={ocupado !== null} aoGravar={gravar} />)}
    </ul>
    <div className="lista-de-modelos">
      <p className="secundario">{catalogo
        ? `Modelos da sua conta${catalogo.origem === 'cache_do_codex' ? ' (última lista guardada pelo Codex)' : ''}, lidos em ${quando(catalogo.obtido_em)}.`
        : 'Não foi possível ler a lista de modelos da sua conta. Use “Outro…” para digitar o nome de um modelo.'}</p>
      <Button variante="ghost" tamanho="sm" disabled={ocupado !== null} onClick={() => void atualizar()}>{ocupado === 'lista' ? 'Atualizando…' : 'Atualizar a lista'}</Button>
    </div>
    {aviso && <p className={aviso.tipo === 'erro' ? 'aviso' : 'dados'} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>{aviso.texto}</p>}
  </section>;
}

function LinhaDaCategoria({ categoria, config, ocupado, aoGravar }: {
  categoria: CategoriaDeExecucao; config: ConfiguracaoDosModelos; ocupado: boolean;
  aoGravar: (categoria: CategoriaDeExecucao, escolha: EscolhaDaCategoria) => Promise<boolean>;
}): ReactNode {
  const { escolha } = categoria;
  const modelos = config.catalogo?.modelos ?? [];
  const foraDaLista = escolha.modelo !== null && !modelos.some((m) => m.id === escolha.modelo);
  const [digitando, digitar] = useState(false);
  const [nome, definirNome] = useState('');
  const valorDoModelo = digitando ? OUTRO : escolha.modelo ?? PADRAO;

  const escolherModelo = (valor: string) => {
    if (valor === OUTRO) { digitar(true); definirNome(foraDaLista ? escolha.modelo ?? '' : ''); return; }
    digitar(false);
    void aoGravar(categoria, { ...escolha, modelo: valor === PADRAO ? null : valor });
  };
  const usarDigitado = async () => {
    if (await aoGravar(categoria, { ...escolha, modelo: nome.trim() })) digitar(false);
  };

  return <li className="categoria-de-modelo">
    <div className="sobre-a-categoria">
      <h3>{categoria.rotulo}</h3>
      <p className="secundario">{categoria.descricao}</p>
      <p className="padrao-da-categoria">Padrão: {categoria.padrao.texto}.</p>
    </div>
    <div className="escolha-da-categoria">
      <label>Modelo
        <Select aria-label={`Modelo · ${categoria.rotulo}`} value={valorDoModelo} disabled={ocupado} onChange={(e) => escolherModelo(e.target.value)}>
          <option value={PADRAO}>Padrão do Margem</option>
          {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          {foraDaLista && escolha.modelo !== null && <option value={escolha.modelo}>{escolha.modelo}</option>}
          <option value={OUTRO}>Outro…</option>
        </Select>
      </label>
      <label>Esforço
        <Select aria-label={`Esforço · ${categoria.rotulo}`} value={escolha.esforco ?? PADRAO} disabled={ocupado}
          onChange={(e) => void aoGravar(categoria, { ...escolha, esforco: e.target.value === PADRAO ? null : e.target.value as Esforco })}>
          <option value={PADRAO}>Padrão do Margem</option>
          {config.esforcos.map((esforco) => <option key={esforco.id} value={esforco.id}>{esforco.rotulo[0]?.toLocaleUpperCase('pt-BR')}{esforco.rotulo.slice(1)}</option>)}
        </Select>
      </label>
      {digitando && <div className="modelo-digitado">
        <Input aria-label={`Nome do modelo · ${categoria.rotulo}`} value={nome} placeholder="ex.: gpt-6-astra" autoComplete="off" spellCheck={false} disabled={ocupado}
          onChange={(e) => definirNome(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && nome.trim()) void usarDigitado(); }} />
        <Button variante="primario" tamanho="md" disabled={ocupado || nome.trim() === ''} onClick={() => void usarDigitado()}>Usar</Button>
        <Button variante="ghost" tamanho="md" disabled={ocupado} onClick={() => digitar(false)}>Cancelar</Button>
      </div>}
    </div>
  </li>;
}
