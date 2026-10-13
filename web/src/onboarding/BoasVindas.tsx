import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button, usarFoco } from '../ui/Primitives';
import './onboarding.css';
import { Destaque } from '../ui/marcador/Destaque';
import { CORES_DO_METODO } from '../leitor/preferencias';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { TELAS_DAS_BOAS_VINDAS } from './estado';
import { PrimeiroDocumento, type PropsDoPrimeiroDocumento } from './PrimeiroDocumento';

const GESTOS = [
  { icone: 'grifo', titulo: 'O texto chega marcado', texto: 'Cada trecho importante ganha uma cor pela função que cumpre: a tese, o conceito, a justificativa — ou, num poema, a imagem, o ritmo, a voz.' },
  { icone: 'nota-adesiva', titulo: 'Notas na margem', texto: 'Ao lado de cada marca, na altura do trecho, uma nota curta diz por que ele importa. Suas anotações moram ali também.' },
  { icone: 'pergunta', titulo: 'Pergunte ao texto', texto: 'Selecione uma passagem para anotar, perguntar ou ligá-la a outra. A conversa fica presa ao trecho.' },
  { icone: 'book', titulo: 'Retome de onde parou', texto: 'O Margem guarda o capítulo e a posição. Voltar ao texto é continuar a leitura, em qualquer aparelho.' },
] as const;

/**
 * Boas-vindas em três telas: o que é o Margem, como se lê nele e o primeiro documento.
 * Pular (ou Esc) fecha e lembra; "Primeiros passos" reabre.
 */
export function BoasVindas({ ir, fontes }: { ir: (destino: Rota) => void; fontes?: PropsDoPrimeiroDocumento['fontes'] }): ReactNode {
  const { estado, despachar } = usarOnboarding();
  const raiz = useRef<HTMLDivElement>(null);
  const titulo = useId();
  const pular = () => despachar({ tipo: 'pular_boas_vindas' });
  usarFoco(raiz, pular);
  const tela = estado.tela;
  const ultima = tela === TELAS_DAS_BOAS_VINDAS - 1;
  // Ao trocar de tela o botão focado pode sumir: o foco vai para o título da nova tela.
  const primeira = useRef(true);
  useEffect(() => {
    // Na abertura, o foco vai para a ação principal (o usarFoco pôs no primeiro botão, o "Pular").
    if (primeira.current) { primeira.current = false; raiz.current?.querySelector<HTMLElement>('.boas-vindas-rodape .ui-primario')?.focus({ preventScroll: true }); return; }
    raiz.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [tela]);
  return <div className="ui-veu veu-boas-vindas">
    <div ref={raiz} role="dialog" aria-modal="true" aria-labelledby={titulo} tabIndex={-1} className="card boas-vindas" data-tela={tela}>
      <header className="boas-vindas-topo">
        <span className="eyebrow">Primeiros passos · {tela + 1} de {TELAS_DAS_BOAS_VINDAS}</span>
        <Button variante="ghost" className="small pular" onClick={pular}>Pular</Button>
      </header>
      {tela === 0 && <>
        <h2 id={titulo} tabIndex={-1}>Boas-vindas ao Margem</h2>
        <p className="boas-vindas-lead">Um leitor de <strong>leitura aumentada</strong>: o texto chega marcado pelo que cada trecho faz no argumento, com notas na margem, perguntas presas à passagem e a leitura guardada onde você parou.</p>
        <Amostra />
      </>}
      {tela === 1 && <>
        <h2 id={titulo} tabIndex={-1}>Como se lê no Margem</h2>
        <ul className="gestos">{GESTOS.map((gesto) => <li key={gesto.titulo}><span className="gesto-icone"><Icon name={gesto.icone} size={20} /></span><div><h3>{gesto.titulo}</h3><p>{gesto.texto}</p></div></li>)}</ul>
      </>}
      {tela === 2 && <>
        <h2 id={titulo} tabIndex={-1}>Seu primeiro texto</h2>
        <p className="boas-vindas-lead">Comece pelo exemplo ou traga o que você está lendo. As marcas chegam depois, quando você pedir a leitura do Margem na página do documento.</p>
        <PrimeiroDocumento ir={ir} aoSair={() => despachar({ tipo: 'concluir_boas_vindas' })} {...(fontes ? { fontes } : {})} />
      </>}
      <footer className="boas-vindas-rodape">
        <span className="pontos-das-telas" aria-hidden="true">{Array.from({ length: TELAS_DAS_BOAS_VINDAS }, (_, i) => <span key={i} data-atual={i === tela} />)}</span>
        <div className="button-row">
          {tela > 0 && <Button variante="ghost" onClick={() => despachar({ tipo: 'voltar_tela' })}>Voltar</Button>}
          {ultima
            ? <Button onClick={() => despachar({ tipo: 'concluir_boas_vindas' })}>Explorar sozinho</Button>
            : <Button variante="primario" onClick={() => despachar({ tipo: 'avancar_tela' })}>Continuar <Icon name="arrow" size={16} /></Button>}
        </div>
      </footer>
    </div>
  </div>;
}

/** Um trecho com marca e nota, desenhado como no leitor: a marca é traço SVG, o texto não muda. */
function Amostra(): ReactNode {
  return <figure className="amostra-do-leitor" aria-label="Exemplo: um trecho marcado com a nota na margem">
    <p className="amostra-texto">— Que lhe importa o meu ar? <Destaque acao="grifo" cor={CORES_DO_METODO.tese} animacao={false} semente="amostra">Cada qual tem o ar que Deus lhe deu.</Destaque> Importe-se com a sua vida e deixe a dos outros.</p>
    <figcaption className="amostra-nota"><span className="amostra-numero" style={{ color: CORES_DO_METODO.tese, borderColor: CORES_DO_METODO.tese }}>1</span><span className="amostra-rotulo">Tese</span><span className="amostra-comentario">A linha responde à agulha com a ideia que o conto vai pôr à prova.</span></figcaption>
  </figure>;
}
