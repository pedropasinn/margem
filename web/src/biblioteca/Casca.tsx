/**
 * A biblioteca inteira com os contextos de que ela precisa (conexão, primeiros passos e estado da instalação)
 * e, no app de computador, o aviso de versão nova pronta (J146).
 */
import type { ReactNode } from 'react';
import { ContextoDeConexao } from '../leitor/ContextoDeConexao';
import { ProvedorDoOnboarding } from '../onboarding/ContextoDoOnboarding';
import { ProvedorDaInstalacao } from '../primeira-execucao/ContextoDaInstalacao';
import { AvisoDeAtualizacao } from '../atualizacao/AvisoDeAtualizacao';
import { App } from './App';

export function Biblioteca(): ReactNode {
  return <ContextoDeConexao><ProvedorDoOnboarding><ProvedorDaInstalacao><App /><AvisoDeAtualizacao /></ProvedorDaInstalacao></ProvedorDoOnboarding></ContextoDeConexao>;
}
