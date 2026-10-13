import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, Input, Popover, Switch } from '../ui/Primitives';
import { usarAparencia } from './ContextoDeAparencia';
import { usarFuncoes } from './ContextoDosModos';
import { CORES_DE_CONTRASTE, CORES_DO_METODO, TAMANHO_MAXIMO, TAMANHO_MINIMO, type Preferencias } from './preferencias';
import { proximoZoom, ZOOM_MAXIMO, ZOOM_MINIMO } from './zoom';
import { BotaoDaBarra } from './BarraDoLeitor';
import { Icon } from '../ui/Icon';
import './aparencia.css';

/**
 * A pílula do canto inferior direito (Player v2, etapa 2). No PDF: − e + andam pelos passos do zoom, a
 * porcentagem volta a ajustar à largura, e ⌄ desce para a próxima página. No texto corrido: A− e A+ no
 * tamanho da letra (16–32 px; 22 é o padrão da UI editorial). Os mesmos passos valem para Ctrl/⌘ + e −,
 * Ctrl + roda do mouse e a paleta.
 */
export function PilulaDeLeitura({ pdf, escala, aoProximaPagina }: { pdf: boolean; escala: number; aoProximaPagina?: (() => void) | undefined }): ReactNode {
  const { preferencias: p, alterar } = usarAparencia();
  const mudar = (valores: Partial<Preferencias>) => alterar({ tipo: 'alterar', valores });
  if (!pdf) {
    return <div className="pilula-de-leitura" role="group" aria-label="Tamanho do texto">
      <IconButton aria-label="Diminuir o texto" data-dica="Diminuir o texto" disabled={p.tamanho <= TAMANHO_MINIMO} onClick={() => mudar({ tamanho: Math.max(TAMANHO_MINIMO, p.tamanho - 1) })}><Icon name="letra-menor" size={18} /></IconButton>
      <span className="pilula-valor" aria-live="polite">{p.tamanho} px</span>
      <IconButton aria-label="Aumentar o texto" data-dica="Aumentar o texto" disabled={p.tamanho >= TAMANHO_MAXIMO} onClick={() => mudar({ tamanho: Math.min(TAMANHO_MAXIMO, p.tamanho + 1) })}><Icon name="letra-maior" size={18} /></IconButton>
    </div>;
  }
  const porcentagem = `${String(Math.round(escala * 100))}%`;
  return <div className="pilula-de-leitura" role="group" aria-label="Zoom do PDF">
    <IconButton aria-label="Diminuir zoom" data-dica="Diminuir" data-atalho="Ctrl −" disabled={escala <= ZOOM_MINIMO + .005} onClick={() => mudar({ zoomPdf: proximoZoom(escala, -1) })}><Icon name="menos" size={16} /></IconButton>
    <button type="button" className="zoom-atual" data-dica={p.zoomPdf === 'largura' ? 'Ajustado à largura' : 'Ajustar à largura'} data-atalho={p.zoomPdf === 'largura' ? undefined : 'Ctrl 0'}
      aria-label={`Zoom ${porcentagem}${p.zoomPdf === 'largura' ? ', ajustado à largura' : '; ajustar à largura'}`} aria-pressed={p.zoomPdf === 'largura'} onClick={() => mudar({ zoomPdf: 'largura' })}>{porcentagem}</button>
    <IconButton aria-label="Aumentar zoom" data-dica="Aumentar" data-atalho="Ctrl +" disabled={escala >= ZOOM_MAXIMO - .005} onClick={() => mudar({ zoomPdf: proximoZoom(escala, 1) })}><Icon name="somar" size={16} /></IconButton>
    <span className="pilula-traco" aria-hidden="true" />
    <IconButton aria-label="Próxima página" data-dica="Próxima página" disabled={!aoProximaPagina} onClick={aoProximaPagina}><Icon name="abaixo" size={18} /></IconButton>
  </div>;
}
export function CoresDasMarcas(): ReactNode {
  const { funcoes } = usarFuncoes(); const { preferencias: p, alterar } = usarAparencia();
  const mudar = (valores: Partial<Preferencias>) => alterar({ tipo: 'alterar', valores });
  return <div className="cores-das-marcas"><p className="cores-titulo">Cores das marcas</p><div className="cores-funcoes">{(funcoes.length ? funcoes : Object.entries(p.cores).map(([chave, corAtual]) => ({ chave, rotulo: chave, corAtual }))).map((f) => <label key={f.chave}>{f.rotulo}<Input type="color" value={p.coresPersonalizadas[f.chave] ?? f.corAtual} onChange={(e) => mudar({ coresPersonalizadas: { ...p.coresPersonalizadas, [f.chave]: e.target.value } })} /></label>)}</div><Button onClick={() => mudar({ cores: CORES_DO_METODO, coresPersonalizadas: {} })}>Cores do método</Button><Button onClick={() => mudar({ cores: CORES_DE_CONTRASTE, coresPersonalizadas: CORES_DE_CONTRASTE, intensidade: .45 })}>Alto contraste</Button></div>;
}
/** Uma linha do popover: ícone, nome, valor e − / + (sem slider). */
function LinhaDeAjuste({ icone, rotulo, valor, aoMenos, aoMais, podeMenos, podeMais }: { icone: string; rotulo: string; valor: string; aoMenos: () => void; aoMais: () => void; podeMenos: boolean; podeMais: boolean }): ReactNode {
  return <div className="linha-de-ajuste" role="group" aria-label={rotulo}>
    <Icon name={icone} size={18} /><span className="linha-rotulo">{rotulo}</span><output className="linha-valor" aria-label={`${rotulo}: ${valor}`}>{valor}</output>
    <IconButton aria-label={`Diminuir ${rotulo.toLocaleLowerCase('pt-BR')}`} disabled={!podeMenos} onClick={aoMenos}><Icon name="menos" size={14} /></IconButton>
    <IconButton aria-label={`Aumentar ${rotulo.toLocaleLowerCase('pt-BR')}`} disabled={!podeMais} onClick={aoMais}><Icon name="somar" size={14} /></IconButton>
  </div>;
}

/** Blocos visuais de escolha única (tema, estilo, traço, margem): um `radiogroup` de botões. */
export function Blocos<T extends string>({ rotulo, valor, opcoes, aoMudar, classe = '' }: { rotulo: string; valor: T; opcoes: readonly { valor: T; rotulo: string; previa: ReactNode }[]; aoMudar: (valor: T) => void; classe?: string }): ReactNode {
  return <div className={`escolhas ${classe}`} role="radiogroup" aria-label={rotulo}>{opcoes.map((opcao) => (
    <button key={opcao.valor} type="button" role="radio" aria-checked={valor === opcao.valor} className="escolha" onClick={() => aoMudar(opcao.valor)}>
      <span className="escolha-previa" aria-hidden="true">{opcao.previa}</span><span className="escolha-rotulo">{opcao.rotulo}</span>
    </button>))}
  </div>;
}

/** A miniprévia de uma marca: uma linha de "texto" com o estilo e o traço escolhidos. */
function PreviaDaMarca({ estilo, traco }: { estilo: Preferencias['estilo']; traco: Preferencias['traco'] }): ReactNode {
  const mao = traco === 'mao';
  const faixa = mao ? 'M3 8.5c6-.8 14 .6 22-.3 5-.4 9 .5 12 .2v7c-4 .4-8-.5-13 .1-6 .5-15-.5-21 .3z' : 'M3 8h34v8H3z';
  const linha = mao ? 'M3 17.5c7-.7 13 .5 20-.2 6-.5 10 .4 14 .1' : 'M3 17.5h34';
  return <svg viewBox="0 0 40 24" width="40" height="24">
    {(estilo === 'grifo' || estilo === 'marca_texto') && <path d={faixa} fill="var(--tese)" opacity=".45" />}
    {(estilo === 'grifo' || estilo === 'sublinhado') && <path d={linha} fill="none" stroke="var(--texto-1)" strokeWidth="1.3" strokeLinecap="round" />}
    <path d="M6 12.5h8M17 12.5h5M25 12.5h10" stroke="var(--texto-2)" strokeWidth="2.2" strokeLinecap="round" />
    {estilo === 'margem' && <circle cx="36" cy="5" r="3" fill="none" stroke="var(--tese)" strokeWidth="1.3" />}
  </svg>;
}

const ESPACAMENTOS = [['normal', 'Normal'], ['amplo', 'Amplo'], ['maximo', 'Máximo']] as const;
const ENTRELINHAS = [['compacta', 'Compacta'], ['normal', 'Normal'], ['folgada', 'Ampla']] as const;
const MEDIDAS = [[65, 'Estreita'], [68, 'Média'], [70, 'Ampla']] as const;

/**
 * Aparência como popover (Player v2, etapa 3, no estilo do Readwise): o tema em blocos; tamanho,
 * entrelinha e largura em linhas com − e +; o estilo e o traço da marca em blocos com a miniprévia;
 * a intensidade com − e +; a margem e, quando há relações, braquetes ou bolinhas (`extra`). Os ajustes
 * finos do traço e as cores ficam recolhidos. Sem listas suspensas nem sliders; cabe sem rolar.
 */
export function Aparencia({ abertaInicialmente = false, extra }: { abertaInicialmente?: boolean; pdf?: boolean; escalaPdf?: number; extra?: ReactNode }): ReactNode {
  const [aberta, abrir] = useState(abertaInicialmente); const botao = useRef<HTMLButtonElement>(null);
  const { preferencias: p, alterar } = usarAparencia();
  const mudar = (valores: Partial<Preferencias>) => alterar({ tipo: 'alterar', valores });
  const passo = <T,>(lista: readonly T[], atual: T, delta: 1 | -1): T => lista[Math.max(0, Math.min(lista.length - 1, lista.indexOf(atual) + delta))] ?? atual;
  const entrelinhas = ENTRELINHAS.map(([valor]) => valor);
  const medidas = MEDIDAS.map(([valor]) => valor);
  const espacamentos = ESPACAMENTOS.map(([valor]) => valor);
  const iEntrelinha = entrelinhas.indexOf(p.entrelinha); const iMedida = medidas.indexOf(p.medida); const iEspacamento = espacamentos.indexOf(p.espacamento);
  const intensidade = Math.round(p.intensidade * 100);
  return <div className="aparencia"><BotaoDaBarra ref={botao} rotulo="Aparência" icone="aparencia" aria-expanded={aberta} onClick={() => abrir(!aberta)} />
    {aberta && <Popover ancora={botao} aoFechar={() => abrir(false)} rotulo="Aparência da leitura" largura={340} className="painel-aparencia">
      <div className="aparencia-cabeca"><h2>Tema</h2><IconButton aria-label="Fechar" onClick={() => abrir(false)}><Icon name="xis" size={16} /></IconButton></div>
      <Blocos rotulo="Tema" classe="escolhas-tema" valor={p.tema} aoMudar={(tema) => mudar({ tema })} opcoes={[
        { valor: 'claro', rotulo: 'Claro', previa: <Icon name="sol" size={18} /> },
        { valor: 'sepia', rotulo: 'Sépia', previa: <span className="letra-sepia">Aa</span> },
        { valor: 'escuro', rotulo: 'Escuro', previa: <Icon name="lua" size={18} /> },
        { valor: 'sistema', rotulo: 'Sistema', previa: <Icon name="sistema" size={18} /> },
      ]} />
      <h3>Texto</h3>
      <div className="linhas-de-ajuste">
        <LinhaDeAjuste icone="tamanho" rotulo="Tamanho" valor={`${String(p.tamanho)} px`} podeMenos={p.tamanho > TAMANHO_MINIMO} podeMais={p.tamanho < TAMANHO_MAXIMO}
          aoMenos={() => mudar({ tamanho: Math.max(TAMANHO_MINIMO, p.tamanho - 1) })} aoMais={() => mudar({ tamanho: Math.min(TAMANHO_MAXIMO, p.tamanho + 1) })} />
        <LinhaDeAjuste icone="entrelinha" rotulo="Entrelinha" valor={ENTRELINHAS[iEntrelinha]?.[1] ?? ''} podeMenos={iEntrelinha > 0} podeMais={iEntrelinha < entrelinhas.length - 1}
          aoMenos={() => mudar({ entrelinha: passo(entrelinhas, p.entrelinha, -1) })} aoMais={() => mudar({ entrelinha: passo(entrelinhas, p.entrelinha, 1) })} />
        <LinhaDeAjuste icone="largura" rotulo="Largura" valor={MEDIDAS[iMedida]?.[1] ?? ''} podeMenos={iMedida > 0} podeMais={iMedida < medidas.length - 1}
          aoMenos={() => mudar({ medida: passo(medidas, p.medida, -1) })} aoMais={() => mudar({ medida: passo(medidas, p.medida, 1) })} />
        <LinhaDeAjuste icone="espacamento" rotulo="Espaçamento" valor={ESPACAMENTOS[iEspacamento]?.[1] ?? ''} podeMenos={iEspacamento > 0} podeMais={iEspacamento < espacamentos.length - 1}
          aoMenos={() => mudar({ espacamento: passo(espacamentos, p.espacamento, -1) })} aoMais={() => mudar({ espacamento: passo(espacamentos, p.espacamento, 1) })} />
      </div>
      <Blocos rotulo="Alinhamento" classe="escolhas-dois" valor={p.alinhamento} aoMudar={(alinhamento) => mudar({ alinhamento })} opcoes={[
        { valor: 'justificado', rotulo: 'Justificado', previa: <Icon name="justificado" size={18} /> },
        { valor: 'esquerda', rotulo: 'À esquerda', previa: <Icon name="alinhar-esquerda" size={18} /> },
      ]} />
      <h3>Marcas</h3>
      <Blocos rotulo="Estilo das marcas" valor={p.estilo} aoMudar={(estilo) => mudar({ estilo })} opcoes={([['grifo', 'Grifo'], ['marca_texto', 'Marca-texto'], ['sublinhado', 'Sublinhado'], ['margem', 'Só na margem']] as const)
        .map(([valor, rotulo]) => ({ valor, rotulo, previa: <PreviaDaMarca estilo={valor} traco={p.traco} /> }))} />
      <Blocos rotulo="Traço" classe="escolhas-dois" valor={p.traco} aoMudar={(traco) => mudar({ traco })} opcoes={([['regua', 'Régua'], ['mao', 'À mão']] as const)
        .map(([valor, rotulo]) => ({ valor, rotulo, previa: <PreviaDaMarca estilo={p.estilo === 'margem' ? 'grifo' : p.estilo} traco={valor} /> }))} />
      <div className="linhas-de-ajuste">
        <LinhaDeAjuste icone="intensidade" rotulo="Intensidade" valor={`${String(intensidade)}%`} podeMenos={p.intensidade > 0} podeMais={p.intensidade < 1}
          aoMenos={() => mudar({ intensidade: Math.max(0, Math.round((p.intensidade - .05) * 100) / 100) })} aoMais={() => mudar({ intensidade: Math.min(1, Math.round((p.intensidade + .05) * 100) / 100) })} />
      </div>
      <h3>Margem</h3>
      <Blocos rotulo="Margem" classe="escolhas-dois" valor={p.margem} aoMudar={(margem) => mudar({ margem })} opcoes={[
        { valor: 'recolher', rotulo: 'Números', previa: <Icon name="numeros" size={18} /> },
        { valor: 'mostrar', rotulo: 'Notas', previa: <Icon name="nota-adesiva" size={18} /> },
      ]} />
      {extra}
      <h3>Teclado</h3>
      <Switch checked={p.atalhosDeLetra} onChange={(atalhosDeLetra) => mudar({ atalhosDeLetra })}>Atalhos de uma tecla (H, N, M, [, ]…)</Switch>
      <details className="ajustes-do-traco"><summary><Icon name="ajustes" size={16} />Ajustes do traço e cores</summary>
        {p.traco === 'mao' && <div className="linhas-de-ajuste"><LinhaDeAjuste icone="mao" rotulo="Rugosidade" valor={`${String(Math.round(p.rugosidade * 100))}%`} podeMenos={p.rugosidade > 0} podeMais={p.rugosidade < 1}
          aoMenos={() => mudar({ rugosidade: Math.max(0, Math.round((p.rugosidade - .1) * 100) / 100) })} aoMais={() => mudar({ rugosidade: Math.min(1, Math.round((p.rugosidade + .1) * 100) / 100) })} /></div>}
        <Switch checked={p.animacao} onChange={(animacao) => mudar({ animacao })}>Animar ao entrar na tela</Switch>
        <CoresDasMarcas />
      </details>
      <Button variante="ghost" className="restaurar-aparencia" onClick={() => alterar({ tipo: 'restaurar' })}><Icon name="restaurar" size={14} />Restaurar aparência</Button>
    </Popover>}
  </div>;
}
