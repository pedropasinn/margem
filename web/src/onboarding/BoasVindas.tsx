import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button, usarFoco } from '../ui/Primitives';
import { Assinatura } from '../ui/Assinatura';
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
  { icone: 'pergunta', titulo: 'Pergunte ao texto', texto: 'Selecione uma passagem para grifar, perguntar ou ligá-la a outra. A conversa fica presa ao trecho.' },
  { icone: 'resolver', titulo: 'Exercícios dentro do livro', texto: 'Num PDF, recorte o enunciado na página e peça a resolução passo a passo, com o livro como contexto.' },
  { icone: 'book', titulo: 'Retome de onde parou', texto: 'O Margem guarda o capítulo e a posição. Voltar ao texto é continuar a leitura, em qualquer aparelho.' },
] as const;

/** Os três jeitos de estudar no Margem: ler, assistir e observar, cada um com o seu gesto. */
const JEITOS = [
  { icone: 'livro', titulo: 'Ler', texto: 'Livros, PDFs e artigos chegam marcados pela função de cada trecho, com notas na margem e perguntas presas à passagem.' },
  { icone: 'video-doc', titulo: 'Assistir', texto: 'O vídeo toca ao lado da transcrição. Clique numa frase para ir ao momento; marque e pergunte como num texto.' },
  { icone: 'quadro', titulo: 'Observar', texto: 'O quadro é percorrido por regiões: o que se vê, o que se sabe dele e de onde vem cada afirmação, com narração.' },
] as const;

/**
 * Boas-vindas em quatro telas: o que é o Margem, os três jeitos de estudar, como se lê e o primeiro
 * exemplo (um texto, um quadro, um vídeo ou o que a pessoa trouxer).
 * Pular (ou Esc) fecha e lembra; "Primeiros passos" reabre.
 */
export function BoasVindas({ ir, fontes, quadros }: { ir: (destino: Rota) => void; fontes?: PropsDoPrimeiroDocumento['fontes']; quadros?: PropsDoPrimeiroDocumento['quadros'] }): ReactNode {
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
        <Assinatura lema className="boas-vindas-assinatura" />
        <h2 id={titulo} tabIndex={-1}>Boas-vindas ao Margem</h2>
        <p className="boas-vindas-lead">Um lugar para estudar o que você <strong>lê, assiste e observa</strong>: livros e PDFs marcados pela função de cada trecho, vídeos com a transcrição ao lado e quadros com uma leitura guiada.</p>
        <Amostra />
      </>}
      {tela === 1 && <>
        <h2 id={titulo} tabIndex={-1}>Três jeitos de estudar</h2>
        <TresJeitos />
      </>}
      {tela === 2 && <>
        <h2 id={titulo} tabIndex={-1}>Como se lê no Margem</h2>
        <ul className="gestos">{GESTOS.map((gesto) => <li key={gesto.titulo}><span className="gesto-icone"><Icon name={gesto.icone} size={20} /></span><div><h3>{gesto.titulo}</h3><p>{gesto.texto}</p></div></li>)}</ul>
      </>}
      {tela === 3 && <>
        <h2 id={titulo} tabIndex={-1}>Comece por um exemplo</h2>
        <p className="boas-vindas-lead">Abra um exemplo para ver o Margem funcionando, ou traga o que você está estudando. Nos textos, as marcas chegam quando você pede a leitura do Margem na página do documento.</p>
        <PrimeiroDocumento ir={ir} aoSair={() => despachar({ tipo: 'concluir_boas_vindas' })} {...(fontes ? { fontes } : {})} {...(quadros ? { quadros } : {})} />
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

/** Ler, assistir e observar, cada um com o seu gesto (também na primeira execução do app de computador). */
export function TresJeitos(): ReactNode {
  return <ul className="tres-jeitos">{JEITOS.map((jeito) => <li key={jeito.titulo}><span className="gesto-icone"><Icon name={jeito.icone} size={20} /></span><h3>{jeito.titulo}</h3><p>{jeito.texto}</p></li>)}</ul>;
}

/** Um trecho com marca e nota, desenhado como no leitor: a marca é traço SVG, o texto não muda. */
function Amostra(): ReactNode {
  return <figure className="amostra-do-leitor" aria-label="Exemplo: um trecho marcado com a nota na margem">
    <p className="amostra-texto">— Que lhe importa o meu ar? <Destaque acao="grifo" cor={CORES_DO_METODO.tese} animacao={false} semente="amostra">Cada qual tem o ar que Deus lhe deu.</Destaque> Importe-se com a sua vida e deixe a dos outros.</p>
    <figcaption className="amostra-nota"><span className="amostra-numero" style={{ color: CORES_DO_METODO.tese, borderColor: CORES_DO_METODO.tese }}>1</span><span className="amostra-rotulo">Tese</span><span className="amostra-comentario">A linha responde à agulha com a ideia que o conto vai pôr à prova.</span></figcaption>
  </figure>;
}
