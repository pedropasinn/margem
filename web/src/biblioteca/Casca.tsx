/** A biblioteca inteira com os contextos de que ela precisa (conexão, primeiros passos e estado da instalação). */
import type { ReactNode } from 'react';
import { ContextoDeConexao } from '../leitor/ContextoDeConexao';
import { ProvedorDoOnboarding } from '../onboarding/ContextoDoOnboarding';
import { ProvedorDaInstalacao } from '../primeira-execucao/ContextoDaInstalacao';
import { App } from './App';

export function Biblioteca(): ReactNode {
  return <ContextoDeConexao><ProvedorDoOnboarding><ProvedorDaInstalacao><App /></ProvedorDaInstalacao></ProvedorDoOnboarding></ContextoDeConexao>;
}
