/**
 * Limite de erro (I-08): uma exceção ao desenhar uma parte da tela (o leitor, o módulo do PDF que não
 * carregou) não derruba o app inteiro numa tela branca. No lugar da parte que falhou fica uma mensagem
 * em português, com "Tentar novamente" e "Voltar à biblioteca". O erro original vai para o console.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Primitives';

export interface PropsDoLimite {
  children: ReactNode;
  /** A frase do título; o padrão fala da parte que não abriu. */
  titulo?: string;
  /** Antes de desenhar de novo (ex.: recriar o import dinâmico que falhou). Sem ela, só desenha de novo. */
  aoTentar?: () => void;
  /** Voltar à biblioteca pelo roteador; sem ela, o link recarrega a página na biblioteca. */
  aoVoltar?: () => void;
  /**
   * Quando muda (ex.: o capítulo aberto), a falha anterior é esquecida e a parte desenha de novo.
   * Ao contrário de `key`, não desmonta os filhos: o estado deles (a pilha de desfazer) fica (R-07).
   */
  resetKey?: unknown;
}

interface EstadoDoLimite { falha: unknown; resetKey: unknown }

export class LimiteDeErro extends Component<PropsDoLimite, EstadoDoLimite> {
  override state: EstadoDoLimite = { falha: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(falha: unknown): Partial<EstadoDoLimite> {
    return { falha: falha ?? new Error('falha ao desenhar') };
  }

  static getDerivedStateFromProps(props: PropsDoLimite, estado: EstadoDoLimite): Partial<EstadoDoLimite> | null {
    return Object.is(props.resetKey, estado.resetKey) ? null : { falha: null, resetKey: props.resetKey };
  }

  override componentDidCatch(falha: unknown, info: ErrorInfo): void {
    console.error('Margem: falha ao desenhar a tela', falha, info.componentStack);
  }

  private readonly tentar = (): void => {
    this.props.aoTentar?.();
    this.setState({ falha: null });
  };

  override render(): ReactNode {
    if (this.state.falha === null) return this.props.children;
    const { titulo = 'Não foi possível mostrar esta parte do Margem.', aoVoltar } = this.props;
    return <div className="empty limite-de-erro" role="alert">
      <h2>{titulo}</h2>
      <p>Algo deu errado ao abrir a tela. Seus textos e notas continuam guardados.</p>
      <p className="limite-de-erro-acoes">
        <Button variante="primario" onClick={this.tentar}>Tentar novamente</Button>
        <a className="ui-button ui-ghost" href="/" onClick={aoVoltar ? (evento) => { evento.preventDefault(); this.setState({ falha: null }); aoVoltar(); } : undefined}>Voltar à biblioteca</a>
      </p>
    </div>;
  }
}
