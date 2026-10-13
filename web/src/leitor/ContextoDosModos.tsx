import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MarcaV2, ModoDeLeituraV1 } from '@margem/contratos';
import { usarAparencia } from './ContextoDeAparencia';
import { corDaFuncao, type MarcaDoLeitor } from './f2';
const Contexto = createContext<readonly ModoDeLeituraV1[]>([]);
export function ContextoDosModos({ modos, children }: { modos: readonly ModoDeLeituraV1[]; children: ReactNode }): ReactNode {
  return <Contexto.Provider value={modos}>{children}</Contexto.Provider>;
}
export function usarFuncoes() {
  const modos = useContext(Contexto);
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
  const cor = (chave: string, modo?: MarcaV2['modo']) => corDaFuncao(chave, modo, modos, p, escuro);
  const daMarca = (marca: MarcaDoLeitor) => cor(marca.funcao, 'modo' in marca ? marca.modo : undefined);
  const funcoes = modos.flatMap((m) => m.funcoes.map((f) => ({ ...f, corAtual: cor(f.chave, m) })))
    .filter((f, i, todos) => todos.findIndex((outra) => outra.chave === f.chave) === i);
  return { modos, cor, daMarca, funcoes, escuro };
}
