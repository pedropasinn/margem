/**
 * Exercícios de um documento (`/documentos/:id/exercicios`): todos os exercícios, por capítulo e seção,
 * com o enunciado e a resolução (KaTeX), o estado de cada um e o caminho de volta ao exercício no
 * leitor. Daqui se pede a resolução de um pendente, se tenta de novo o que falhou e se refaz o que já
 * saiu; a lista inteira (ou um capítulo) sai em LaTeX, como `.tex` ou PDF compilado.
 *
 * Tudo o que veio do modelo passa pelo `TextoComMatematica` (texto do React + KaTeX higienizado).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mensagemDeErro } from './erros';
import type { ItemDaResolucaoV1 } from '@margem/contratos';
import { LinhasDoCalculo, TextoComMatematica } from '../leitor/resolucao/Matematica';
import { Esqueleto } from '../ui/Esqueleto';
import { Icon } from '../ui/Icon';
import { Button, Input, Select } from '../ui/Primitives';
import { exerciciosDoDocumento, exportacaoDosExercicios, resolverExercicio, type EstadoDaResolucao, type ExercicioDaLista, type ExerciciosDoDocumento } from './api';
import { gravarIntencao } from './intencao';
import { EstadoVazio } from './Lista';
import type { Rota } from './rotas';

type FiltroDeEstado = '' | 'pronta' | 'pendente' | 'andamento' | 'falhou';
const ROTULO: Record<EstadoDaResolucao, string> = { pronta: 'Resolvido', pendente: 'A resolver', resolvendo: 'Resolvendo…', respondendo: 'Respondendo…', falhou: 'Falhou' };
const EM_ANDAMENTO: ReadonlySet<EstadoDaResolucao> = new Set(['resolvendo', 'respondendo']);
const INTERVALO_MS = 4000;

export interface FontesDosExerciciosDoLivro {
  listar: typeof exerciciosDoDocumento;
  resolver: typeof resolverExercicio;
}
const FONTES: FontesDosExerciciosDoLivro = { listar: exerciciosDoDocumento, resolver: resolverExercicio };

function passa(ex: ExercicioDaLista, estado: FiltroDeEstado, capitulo: string, texto: string): boolean {
  if (estado === 'andamento' ? !EM_ANDAMENTO.has(ex.estado) : estado !== '' && ex.estado !== estado) return false;
  if (capitulo !== '' && ex.capitulo !== capitulo) return false;
  if (texto === '') return true;
  const alvo = `${ex.resolucao.resolucao?.enunciado ?? ''} ${ex.resolucao.texto_extraido} ${ex.secao ?? ''}`.toLocaleLowerCase('pt-BR');
  return alvo.includes(texto.toLocaleLowerCase('pt-BR'));
}

interface Grupo { capitulo: string; secoes: { secao: string | null; itens: ExercicioDaLista[] }[] }
function agrupar(itens: readonly ExercicioDaLista[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const item of itens) {
    let grupo = grupos.at(-1);
    if (grupo?.capitulo !== item.capitulo) { grupo = { capitulo: item.capitulo, secoes: [] }; grupos.push(grupo); }
    let secao = grupo.secoes.at(-1);
    if (!secao || secao.secao !== item.secao) { secao = { secao: item.secao, itens: [] }; grupo.secoes.push(secao); }
    secao.itens.push(item);
  }
  return grupos;
}

function ItemResolvido({ item }: { item: ItemDaResolucaoV1 }): ReactNode {
  return <div className="exercicio-item-resolvido">
    {item.rotulo && <h4>Item {item.rotulo}</h4>}
    <p><span className="eyebrow">Ideia</span><TextoComMatematica texto={item.estrategia} /></p>
    {item.passos.length > 0 && <ol className="exercicio-passos">{item.passos.map((passo, indice) => <li key={indice}>
      <p><TextoComMatematica texto={passo.texto} /></p>
      {passo.calculo && <p className="calculo"><LinhasDoCalculo calculo={passo.calculo} /></p>}
    </li>)}</ol>}
    <p><span className="eyebrow">Resposta</span><TextoComMatematica texto={item.resposta} /></p>
    {item.verificacao && <p className="exercicio-conferencia"><span className="eyebrow">Conferindo</span><TextoComMatematica texto={item.verificacao} /></p>}
  </div>;
}

function Exercicio({ ex, ocupado, aoIr, aoResolver }: { ex: ExercicioDaLista; ocupado: boolean; aoIr: (ex: ExercicioDaLista) => void; aoResolver: (ex: ExercicioDaLista) => void }): ReactNode {
  const { resolucao, estado } = ex;
  const gerada = resolucao.resolucao;
  const origem = resolucao.origem;
  const onde = origem.tipo === 'recorte' ? `p. ${String(origem.pagina)}` : 'trecho';
  const titulo = ex.numero ? `Exercício ${ex.numero}` : 'Exercício';
  const acao = estado === 'pendente' ? 'Resolver' : estado === 'falhou' ? 'Tentar de novo' : estado === 'pronta' ? 'Refazer' : null;
  return <li className="exercicio-da-lista" data-estado={estado}>
    <span className="eyebrow">{titulo} · {onde} · <span className="exercicio-estado">{ROTULO[estado]}</span></span>
    {gerada
      ? <p className="exercicio-enunciado"><TextoComMatematica texto={gerada.enunciado} /></p>
      : origem.tipo === 'recorte'
        ? <img className="exercicio-recorte" src={`/api/resolucoes/${resolucao.id}/imagem`} alt={`Recorte do ${titulo.toLowerCase()}, ${onde}`} loading="lazy" />
        : <blockquote className="exercicio-trecho">{origem.ancora.citacao}</blockquote>}
    {gerada && <details className="exercicio-solucao">
      <summary>Ver a resolução{gerada.itens.length > 1 ? ` (${String(gerada.itens.length)} itens)` : ''}</summary>
      {gerada.itens.map((item, indice) => <ItemResolvido key={`${String(indice)}-${item.rotulo}`} item={item} />)}
    </details>}
    <div className="exercicio-acoes">
      <Button variante="ghost" onClick={() => aoIr(ex)}><Icon name="arrow" size={16} />Ir ao exercício</Button>
      {acao && <Button variante="ghost" disabled={ocupado} onClick={() => aoResolver(ex)}>{acao}</Button>}
    </div>
  </li>;
}

export function Exercicios({ documento_id, ir, fontes = FONTES, intervaloMs = INTERVALO_MS }: { documento_id: string; ir: (destino: Rota) => void; fontes?: FontesDosExerciciosDoLivro; intervaloMs?: number }): ReactNode {
  const [dados, definirDados] = useState<ExerciciosDoDocumento | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [estado, escolherEstado] = useState<FiltroDeEstado>('');
  const [capitulo, escolherCapitulo] = useState('');
  const [texto, definirTexto] = useState('');
  const [ocupado, ocupar] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try { definirDados(await fontes.listar(documento_id)); definirErro(null); }
    catch (falha) { definirErro(mensagemDeErro(falha, 'Não foi possível carregar os exercícios.')); }
  }, [documento_id, fontes]);
  useEffect(() => { void carregar(); }, [carregar]);
  const trabalhando = dados?.exercicios.some((ex) => EM_ANDAMENTO.has(ex.estado)) ?? false;
  useEffect(() => {
    if (!trabalhando) return;
    const relogio = setInterval(() => { void carregar(); }, intervaloMs);
    return () => clearInterval(relogio);
  }, [trabalhando, carregar, intervaloMs]);

  const todos = dados?.exercicios ?? [];
  const filtrados = useMemo(() => todos.filter((ex) => passa(ex, estado, capitulo, texto.trim())), [todos, estado, capitulo, texto]);
  const capitulos = [...new Set(todos.map((ex) => ex.capitulo))];
  const resolvidos = todos.filter((ex) => ex.resolucao.resolucao !== null).length;
  const contagem = (filtro: FiltroDeEstado) => todos.filter((ex) => passa(ex, filtro, '', '')).length;

  const irAoExercicio = (ex: ExercicioDaLista) => {
    const origem = ex.resolucao.origem;
    if (ex.secao_id) {
      gravarIntencao({ documento_id, secao_id: ex.secao_id, resolucao: ex.resolucao.id, ...(origem.tipo === 'recorte' ? { pagina: origem.pagina } : { ancora: origem.ancora }) });
      ir({ nome: 'leitura', documento_id, secao_id: ex.secao_id });
    } else {
      ir({ nome: 'leitura', documento_id });
    }
  };
  const resolver = (ex: ExercicioDaLista) => {
    if (ex.estado === 'pronta' && !window.confirm('Refazer a resolução? A atual (e as perguntas sobre ela) dá lugar a uma nova.')) return;
    ocupar(ex.resolucao.id);
    void fontes.resolver(ex.resolucao.id).then(carregar, (falha: unknown) => definirErro(mensagemDeErro(falha, 'Não foi possível pedir a resolução.')))
      .finally(() => ocupar(null));
  };

  const exportar = { ...(capitulo ? { capitulo } : {}) };
  return <section className="notas exercicios-do-livro" aria-label="Exercícios">
    <header className="notas-cabecalho">
      <a className="voltar" href={`/documentos/${documento_id}`} onClick={(evento) => { evento.preventDefault(); ir({ nome: 'documento', documento_id }); }}><Icon name="voltar" size={16} />Voltar ao documento</a>
      <span className="eyebrow">Exercícios</span>
      <h1>{dados?.documento.titulo ?? 'Exercícios'}</h1>
      <div className="notas-ferramentas">
        <label className="busca-compacta"><Icon name="buscar" size={16} /><Input type="search" aria-label="Procurar nos exercícios" placeholder="Procurar no enunciado" value={texto} onChange={(evento) => definirTexto(evento.target.value)} /></label>
        <Select aria-label="Estado" value={estado} onChange={(evento) => escolherEstado(evento.target.value as FiltroDeEstado)}>
          <option value="">{`Todos (${String(todos.length)})`}</option>
          <option value="pronta">{`Resolvidos (${String(contagem('pronta'))})`}</option>
          <option value="pendente">{`A resolver (${String(contagem('pendente'))})`}</option>
          <option value="andamento">{`Em andamento (${String(contagem('andamento'))})`}</option>
          <option value="falhou">{`Falharam (${String(contagem('falhou'))})`}</option>
        </Select>
        {capitulos.length > 1 && <Select aria-label="Capítulo" value={capitulo} onChange={(evento) => escolherCapitulo(evento.target.value)}>
          <option value="">Todos os capítulos</option>
          {capitulos.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
        </Select>}
        <a className="ui-button ui-secundario" href={exportacaoDosExercicios(documento_id, 'pdf', exportar)} download title="As resoluções em PDF, compilado em LaTeX"><Icon name="exportar" size={16} />PDF</a>
        <a className="ui-button ui-secundario" href={exportacaoDosExercicios(documento_id, 'tex', exportar)} download title="O código LaTeX (.tex)"><Icon name="exportar" size={16} />LaTeX</a>
      </div>
    </header>
    {erro !== null && <p className="aviso" role="alert">Não foi possível carregar os exercícios: {erro}</p>}
    {dados === null && erro === null ? <Esqueleto /> : dados !== null && (todos.length === 0
      ? <EstadoVazio frase="Nenhum exercício ainda. No leitor, use “Resolver exercício” e arraste sobre o exercício na página." />
      : <>
        <p className="notas-contagem" role="status">{resolvidos} de {todos.length} resolvidos{filtrados.length !== todos.length ? ` · ${String(filtrados.length)} com esse filtro` : ''}</p>
        {filtrados.length === 0 && <EstadoVazio frase="Nenhum exercício com esse filtro." />}
        {agrupar(filtrados).map((grupo) => <section key={grupo.capitulo} className="notas-grupo" aria-label={grupo.capitulo}>
          <h2>{grupo.capitulo}</h2>
          {grupo.secoes.map((secao, indice) => <div key={`${secao.secao ?? ''}-${String(indice)}`} className="exercicios-da-secao">
            {secao.secao && <h3>{secao.secao}</h3>}
            <ul className="notas-lista">{secao.itens.map((ex) => <Exercicio key={ex.resolucao.id} ex={ex} ocupado={ocupado === ex.resolucao.id} aoIr={irAoExercicio} aoResolver={resolver} />)}</ul>
          </div>)}
        </section>)}
      </>)}
  </section>;
}
