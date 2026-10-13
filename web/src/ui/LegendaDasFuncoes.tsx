import { usarFuncoes } from '../leitor/ContextoDosModos';
import type { ReactNode } from 'react';
import { usarAparencia } from '../leitor/ContextoDeAparencia';
export function LegendaDasFuncoes({ compacta = false, presentes }: { compacta?: boolean; presentes?: readonly string[] }): ReactNode {
  const { preferencias } = usarAparencia(); const { funcoes } = usarFuncoes();
  const lista = (funcoes.length ? funcoes : Object.entries(preferencias.cores).map(([chave, corAtual]) => ({ chave, rotulo: chave, corAtual }))).filter((f) => !presentes || presentes.includes(f.chave));
  const mostradas = compacta ? lista.slice(0, 4) : lista;
  return <span className={`legenda-funcoes${compacta ? ' legenda-compacta' : ''}`} aria-label="Legenda das funções">{mostradas.map((f) => <span key={f.chave}><span aria-hidden="true" style={{ color: f.corAtual }}>●</span> {f.rotulo}</span>)}{compacta && lista.length > 4 && <span>+{lista.length - 4}</span>}</span>;
}
