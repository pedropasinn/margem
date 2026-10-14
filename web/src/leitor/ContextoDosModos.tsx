import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ModoDeLeituraV1, ReferenciaModo } from '@margem/contratos';
import { usarAparencia } from './ContextoDeAparencia';
import { corDaFuncao, type MarcaDoLeitor } from './f2';

/**
 * Os modos de leitura à vista do leitor (J138): `modos` são TODOS os do catálogo — cada grifo guarda o
 * seu modo e a sua função, e grifos de modos diferentes convivem no mesmo documento, cada um com a cor e o
 * rótulo do seu modo. `principais` são os modos do trecho/documento (o do tipo de texto e os das camadas
 * abertas): as funções deles vêm primeiro no balão do grifo; as dos outros modos ficam em "Outros olhares".
 */
/** Um olhar: uma função num modo (o grifo nasce ou passa para aquele modo). */
export interface Olhar { modo: ReferenciaModo; funcao: string }
interface ValorDosModos {
  modos: readonly ModoDeLeituraV1[]; principais: readonly ReferenciaModo[];
  /** Olhares de outros modos usados há pouco no documento: sobem para a primeira fileira do balão. */
  recentes: readonly Olhar[];
  lembrarOlhar: (olhar: Olhar) => void;
}
const Contexto = createContext<ValorDosModos>({ modos: [], principais: [], recentes: [], lembrarOlhar: () => undefined });
const SEM_PRINCIPAIS: readonly ReferenciaModo[] = [];
const SEM_OLHARES: readonly Olhar[] = [];
const NADA = () => undefined;
export function ContextoDosModos({ modos, principais = SEM_PRINCIPAIS, recentes = SEM_OLHARES, lembrarOlhar = NADA, children }: {
  modos: readonly ModoDeLeituraV1[]; principais?: readonly ReferenciaModo[]; recentes?: readonly Olhar[]; lembrarOlhar?: (olhar: Olhar) => void; children: ReactNode;
}): ReactNode {
  const valor = useMemo(() => ({ modos, principais, recentes, lembrarOlhar }), [modos, principais, recentes, lembrarOlhar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

const chaveDosOlhares = (documentoId: string) => `margem:olhares:${documentoId}`;
/** Os olhares de outros modos lembrados no documento (preferência local, do mais recente ao mais antigo). */
export function olharesLembrados(documentoId: string): Olhar[] {
  try {
    const lidos: unknown = JSON.parse(localStorage.getItem(chaveDosOlhares(documentoId)) ?? '[]');
    return Array.isArray(lidos) ? lidos.filter((o): o is Olhar => typeof o === 'object' && o !== null && typeof (o as Olhar).funcao === 'string'
      && typeof (o as Olhar).modo?.id === 'string' && typeof (o as Olhar).modo?.revisao === 'number').slice(0, 6) : [];
  } catch { return []; }
}
export function lembrarOlharNoDocumento(documentoId: string, olhar: Olhar): Olhar[] {
  const lista = [olhar, ...olharesLembrados(documentoId).filter((o) => !(mesmaReferencia(o.modo, olhar.modo) && o.funcao === olhar.funcao))].slice(0, 6);
  try { localStorage.setItem(chaveDosOlhares(documentoId), JSON.stringify(lista)); } catch { /* sem storage, vale a sessão */ }
  return lista;
}

export const mesmaReferencia = (a: ReferenciaModo | undefined, b: ReferenciaModo | undefined): boolean => a !== undefined && b !== undefined && a.id === b.id && a.revisao === b.revisao;
/** O modo de uma marca (a V1 não tem: é o do método). */
export const modoDaMarca = (marca: MarcaDoLeitor): ReferenciaModo | undefined => ('modo' in marca ? marca.modo : undefined);
/** Chave de uma função num modo: a mesma chave em modos diferentes é outra função (outro rótulo, outra cor). */
export const chaveDaFuncao = (funcao: string, modo: ReferenciaModo | undefined): string => (modo ? `${modo.id}@${String(modo.revisao)}:${funcao}` : funcao);
export const chaveDaFuncaoDaMarca = (marca: MarcaDoLeitor): string => chaveDaFuncao(marca.funcao, modoDaMarca(marca));

export function usarFuncoes() {
  const { modos, principais, recentes, lembrarOlhar } = useContext(Contexto);
  const { preferencias: p } = usarAparencia();
  const [sistemaEscuro, definir] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const consulta = matchMedia('(prefers-color-scheme: dark)');
    const mudar = () => definir(consulta.matches);
    consulta.addEventListener?.('change', mudar);
    return () => consulta.removeEventListener?.('change', mudar);
  }, []);
  const escuro = p.tema === 'escuro' || (p.tema === 'sistema' && sistemaEscuro);
  const cor = (chave: string, modo?: ReferenciaModo) => corDaFuncao(chave, modo, modos, p, escuro);
  const daMarca = (marca: MarcaDoLeitor) => cor(marca.funcao, modoDaMarca(marca));
  const modoDe = (modo: ReferenciaModo | undefined) => (modo ? modos.find((m) => mesmaReferencia(m, modo)) : undefined);
  /** O rótulo da função no modo dela; sem o modo no catálogo, o de qualquer modo que a tenha, ou a chave legível. */
  const rotulo = (chave: string, modo?: ReferenciaModo) => chave === 'nenhuma' ? 'Grifo'
    : modoDe(modo)?.funcoes.find((f) => f.chave === chave)?.rotulo
      ?? modos.flatMap((m) => m.funcoes).find((f) => f.chave === chave)?.rotulo
      ?? chave.replaceAll('_', ' ');
  const rotuloDaMarca = (marca: MarcaDoLeitor) => rotulo(marca.funcao, modoDaMarca(marca));
  /** O nome do modo ("Poesia", "Filosofia"), para distinguir funções de mesmo nome. */
  const nomeDoModo = (modo: ReferenciaModo | undefined) => modoDe(modo)?.nome ?? modo?.id.replaceAll('_', ' ') ?? '';
  // As funções "da casa": as dos modos principais (ou de todos, sem principais), sem repetir a chave.
  const daCasa = principais.length > 0 ? principais.flatMap((ref) => modos.filter((m) => mesmaReferencia(m, ref))) : modos;
  const funcoes = daCasa.flatMap((m) => m.funcoes.map((f) => ({ ...f, modo: { id: m.id, revisao: m.revisao }, corAtual: cor(f.chave, m) })))
    .filter((f, i, todos) => todos.findIndex((outra) => outra.chave === f.chave) === i);
  return { modos, principais, recentes, lembrarOlhar, cor, daMarca, rotulo, rotuloDaMarca, nomeDoModo, funcoes, escuro };
}
