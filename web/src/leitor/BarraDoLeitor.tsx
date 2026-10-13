/**
 * Peças da barra de leitura enxuta (Player v2, etapa 1): botões só com ícone, cada um com a dica e o
 * atalho; a posição no centro ("p. 17 de 191" ou "Cap. 3 de 10"), que vira − e + ao passar o mouse; e
 * os popovers pequenos da atenção e do ouvir. A composição da barra fica no `ReaderController`.
 */
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Input, Popover } from '../ui/Primitives';

type PropsDoBotao = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  rotulo: string;
  icone: string;
  atalho?: string;
  /** Rótulo diferente para o leitor de tela (o `rotulo` continua sendo a dica visível). */
  'aria-label'?: string;
};

/** Botão da barra: só o ícone, com a dica (rótulo e atalho) ao passar o mouse ou focar. */
export const BotaoDaBarra = forwardRef<HTMLButtonElement, PropsDoBotao>(function BotaoDaBarra({ rotulo, icone, atalho, className = '', 'aria-label': nome, ...props }, ref) {
  return <IconButton {...props} ref={ref} aria-label={nome ?? rotulo} className={`botao-da-barra ${className}`} data-dica={rotulo} data-atalho={atalho}>
    <Icon name={icone} size={20} />
  </IconButton>;
});

/** Um traço fino entre os grupos de botões. */
export function Separador(): ReactNode {
  return <span className="separador-da-barra" aria-hidden="true" />;
}

export interface PosicaoNaLeitura {
  tipo: 'pagina' | 'capitulo';
  atual: number;
  total: number;
  anterior?: (() => void) | undefined;
  proximo?: (() => void) | undefined;
  irPara?: ((numero: number) => void) | undefined;
}

/**
 * "p. 17 de 191" ou "Cap. 3 de 10"; no hover, − e + ao lado. O clique no número (ou Shift J) abre o
 * "ir para página/capítulo", um campo só.
 */
export function PosicaoNaBarra({ posicao, irParaAberto, aoAbrirIrPara }: { posicao: PosicaoNaLeitura; irParaAberto: boolean; aoAbrirIrPara: (aberto: boolean) => void }): ReactNode {
  const botao = useRef<HTMLButtonElement>(null);
  const pagina = posicao.tipo === 'pagina';
  const [valor, definirValor] = useState('');
  useEffect(() => { if (irParaAberto) definirValor(''); }, [irParaAberto]);
  const ir = (evento: FormEvent) => {
    evento.preventDefault();
    const numero = Number.parseInt(valor, 10);
    if (!Number.isFinite(numero) || numero < 1 || numero > posicao.total) return;
    aoAbrirIrPara(false);
    posicao.irPara?.(numero);
  };
  const nome = pagina ? 'página' : 'capítulo';
  return <div className="posicao-na-barra" role="group" aria-label={pagina ? 'Página' : 'Capítulo'}>
    <IconButton className="posicao-passo" aria-label={pagina ? 'Página anterior' : 'Capítulo anterior'} disabled={!posicao.anterior} onClick={posicao.anterior}><Icon name="menos" size={16} /></IconButton>
    <button ref={botao} type="button" className="posicao-atual" aria-label={`${pagina ? 'Página' : 'Capítulo'} ${String(posicao.atual)} de ${String(posicao.total)}; ir para ${nome}`}
      data-dica={`Ir para ${nome}…`} data-atalho="Shift J" aria-expanded={irParaAberto} disabled={!posicao.irPara} onClick={() => aoAbrirIrPara(!irParaAberto)}>
      <span className="posicao-numero">{pagina ? '' : 'Cap. '}{posicao.atual}</span> <span className="posicao-total">de {posicao.total}</span>
    </button>
    <IconButton className="posicao-passo" aria-label={pagina ? 'Próxima página' : 'Próximo capítulo'} disabled={!posicao.proximo} onClick={posicao.proximo}><Icon name="somar" size={16} /></IconButton>
    {irParaAberto && posicao.irPara && <Popover ancora={botao} aoFechar={() => aoAbrirIrPara(false)} rotulo={`Ir para ${nome}`} largura={220} className="ir-para">
      <form onSubmit={ir}>
        <label>Ir para {nome}<Input autoFocus inputMode="numeric" aria-label={`Número d${pagina ? 'a página' : 'o capítulo'}`} placeholder={`1–${String(posicao.total)}`} value={valor} onChange={(e) => definirValor(e.target.value.replace(/\D/g, ''))} /></label>
        <Button type="submit" variante="primario">Ir</Button>
      </form>
    </Popover>}
  </div>;
}

/** Uma ação do ouvir (visita, leitura comentada, narração): rótulo, estado e o que faz. */
export interface AcaoDeOuvir {
  id: string;
  rotulo: string;
  detalhe?: string;
  icone: string;
  ativa?: boolean;
  desabilitada?: boolean;
  executar: () => void;
}

export function OuvirNaBarra({ acoes }: { acoes: readonly AcaoDeOuvir[] }): ReactNode {
  const [aberto, abrir] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const tocando = acoes.some((acao) => acao.ativa);
  return <>
    <BotaoDaBarra ref={botao} rotulo="Ouvir" icone="ouvir" aria-expanded={aberto} aria-pressed={tocando || undefined} onClick={() => abrir(!aberto)} />
    {aberto && <Popover ancora={botao} aoFechar={() => abrir(false)} rotulo="Ouvir" largura={300} className="menu-da-barra">
      <ul className="lista-de-acoes">{acoes.map((acao) => <li key={acao.id}>
        <Button variante="ghost" aria-pressed={acao.ativa ?? undefined} disabled={acao.desabilitada} onClick={() => { abrir(false); acao.executar(); }}>
          <Icon name={acao.icone} size={18} /><span><span className="acao-rotulo">{acao.rotulo}</span>{acao.detalhe && <span className="acao-detalhe">{acao.detalhe}</span>}</span>
        </Button>
      </li>)}</ul>
    </Popover>}
  </>;
}

/** O popover da atenção: os quatro pontos, pequeno, abaixo do botão. */
export function AtencaoNaBarra({ children, nivel }: { children: ReactNode; nivel: number }): ReactNode {
  const [aberto, abrir] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  return <>
    <BotaoDaBarra ref={botao} rotulo="Atenção" aria-label={`Atenção: nível ${String(nivel)}`} icone="atencao" aria-expanded={aberto} onClick={() => abrir(!aberto)} />
    {aberto && <Popover ancora={botao} aoFechar={() => abrir(false)} rotulo="Atenção" largura={260} className="menu-da-barra popover-atencao">{children}</Popover>}
  </>;
}
