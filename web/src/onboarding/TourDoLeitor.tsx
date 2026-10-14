import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { DicaAncorada } from './DicaAncorada';
import { mostrarTour, type TipoDeTour } from './estado';

/** Em que pé está a leitura do Margem neste texto: muda o que a primeira dica pode prometer. */
export type SituacaoDasMarcas = 'com_marcas' | 'lendo' | 'sem_marcas';

export interface DicaDoTour { id: string; titulo: string; alvos: readonly string[]; texto: ReactNode }

/** As dicas, na ordem: marcas, margem, aparência, perguntar e conectar, retomada. */
export function dicasDoTour(situacao: SituacaoDasMarcas, pdf: boolean): DicaDoTour[] {
  return [
    { id: 'marcas', titulo: 'As cores dizem a função', alvos: ['.leitor-controlado [data-marcas]', pdf ? '.pdf-pagina' : '.capitulo p[data-bloco]'],
      texto: situacao === 'com_marcas'
        ? <p>Cada trecho marcado tem uma função no texto, e cada cor é uma função do modo de leitura: no estudo, <strong>tese</strong>, <strong>conceito</strong> e <strong>justificativa</strong>; num poema, imagem, ritmo e voz. A legenda fica em <Icon name="reticencias" size={14} /> Mais opções.</p>
        : situacao === 'lendo'
          ? <p>O Margem está lendo este texto agora. Quando a leitura terminar, os trechos importantes ganham cores pela função que cumprem, e as relações entre eles aparecem à esquerda. Pode começar a ler: as marcas aparecem por cima, sem mexer no texto.</p>
          : <p>Este texto ainda não tem marcas. Elas chegam quando você clica em <strong>Analisar</strong> na página do documento: o Margem reconhece o tipo de texto, marca cada trecho importante pela função que cumpre e liga os trechos que conversam entre si.</p> },
    { id: 'margem', titulo: 'Notas na margem', alvos: ['.margem .nota .nota-numero', '.numero-lateral', '.margem'],
      texto: <p>Ao lado de cada marca, na altura do trecho, uma nota curta diz por que ele importa. Passe o mouse para ligar nota e trecho; clique para abrir o fio, as fontes e as conexões. Em telas estreitas, os números na lateral abrem a nota numa folha.</p> },
    { id: 'aparencia', titulo: 'Do seu jeito', alvos: ['.aparencia > .botao-da-barra', 'button[aria-label="Marcas"]'],
      texto: <p><strong>Aa</strong> muda tema, tamanho, entrelinha, largura e o estilo das marcas (grifo, marca-texto ou sublinhado). Ao lado, <strong>Marcas</strong> esconde ou mostra todas as marcas de uma vez.</p> },
    { id: 'perguntar', titulo: 'Pergunte ao texto', alvos: [pdf ? '.pdf-pagina' : '.capitulo p[data-bloco]'],
      texto: <p>Selecione uma passagem: aparece <strong>Grifar · Perguntar · Conectar</strong>. A nota fica no grifo; a pergunta abre uma conversa curta presa ao trecho; conectar liga a passagem a outra, deste ou de outro texto.</p> },
    { id: 'retomada', titulo: 'Retome de onde parou', alvos: ['.voltar-da-barra', '.barra-do-leitor'],
      texto: <p>O Margem guarda o capítulo e a posição enquanto você lê. Ao voltar, o texto abre onde você parou, e o Início mostra o que está em andamento em <strong>Continuar lendo</strong>.</p> },
  ];
}

/** As dicas do vídeo e do áudio: a transcrição que acompanha, as marcas nela, velocidade e capítulos. */
export function dicasDoPlayer(video: boolean): DicaDoTour[] {
  const nome = video ? 'o vídeo' : 'o áudio';
  return [
    { id: 'transcricao', titulo: 'A transcrição acompanha', alvos: ['.capitulo p[data-bloco]', '.player-midia'],
      texto: <p>O texto ao lado é a transcrição: a frase que toca fica em destaque. <strong>Clique numa frase</strong> para levar {nome} até aquele momento.</p> },
    { id: 'marcas', titulo: 'Marque e pergunte como num texto', alvos: ['.capitulo p[data-bloco]'],
      texto: <p>Selecione um trecho da transcrição: aparece <strong>Anotar · Perguntar · Conectar</strong>, como em qualquer texto. As marcas e as notas na margem também valem aqui.</p> },
    { id: 'controles', titulo: 'Velocidade e capítulos', alvos: ['button[aria-label="Velocidade e destaque"]', '.controles-da-midia', '.player-midia'],
      texto: <p>Nos controles do player ficam a <strong>velocidade</strong>, o salto de 10 segundos e os <strong>capítulos</strong>, quando {nome} tem. O Margem guarda onde você parou.</p> },
  ];
}

/** As dicas do quadro: percorrer por regiões, a análise curta narrada e de onde vem cada afirmação. */
export function dicasDoQuadro(): DicaDoTour[] {
  return [
    { id: 'percorrer', titulo: 'Percorra a obra', alvos: ['.botao-percorrer', '.palco-do-quadro'],
      texto: <p><strong>Percorrer</strong> leva de uma região da pintura a outra. Em cada uma, o que se vê e o que se sabe dela, com a região destacada na imagem.</p> },
    { id: 'narracao', titulo: 'A análise curta, narrada', alvos: ['.barra-do-quadro button[aria-label="Análise curta"]', '.acoes-da-analise', '.barra-do-quadro'],
      texto: <p><strong>Análise curta</strong> (Espaço) toca a leitura guiada: a câmera passeia pela obra enquanto a narração conta o que importa.</p> },
    { id: 'fontes', titulo: 'De onde vem cada afirmação', alvos: ['.afirmacoes-do-quadro', '.painel-do-quadro'],
      texto: <p>No painel, cada afirmação diz o que é: algo que se vê, um fato com fonte ou uma inferência. As fontes ficam no fim do painel.</p> },
  ];
}

/**
 * Um tour leve na primeira abertura de um item do tipo. Espera a tela assentar (as marcas, a margem e
 * o player são medidos depois do primeiro desenho) antes de mostrar a primeira dica.
 */
export function TourGuiado({ tour, dicas, ir, atrasoMs = 700 }: { tour: TipoDeTour; dicas: DicaDoTour[]; ir: (destino: Rota) => void; atrasoMs?: number }): ReactNode {
  const { estado, despachar, ativo, pronto } = usarOnboarding();
  const deveMostrar = ativo && pronto && estado.boas_vindas !== 'pendente' && mostrarTour(estado, tour);
  const [assentado, assentar] = useState(atrasoMs === 0);
  useEffect(() => {
    if (!deveMostrar || assentado) return;
    const espera = setTimeout(() => assentar(true), atrasoMs);
    return () => clearTimeout(espera);
  }, [deveMostrar, assentado, atrasoMs]);
  if (!deveMostrar || !assentado) return null;
  const passo = Math.min(estado.dicas[tour], dicas.length - 1);
  const dica = dicas[passo]!;
  const ultima = passo === dicas.length - 1;
  return <DicaAncorada key={`${tour}:${dica.id}`} alvos={dica.alvos} titulo={dica.titulo} passo={passo} total={dicas.length}
    aoAvancar={() => despachar({ tipo: 'avancar_dica', tour, total: dicas.length })}
    aoVoltar={() => despachar({ tipo: 'voltar_dica', tour })}
    aoFechar={() => despachar({ tipo: 'pular_tour', tour })}
    extra={ultima && estado.levar === 'pendente' ? <p className="dica-extra"><Button variante="ghost" className="small" onClick={() => { despachar({ tipo: 'concluir_tour', tour }); ir({ nome: 'configuracoes', secao: 'primeiros-passos' }); }}>
      <Icon name="celular" size={16} /> Leve o Margem com você</Button></p> : undefined}>
    {dica.texto}
  </DicaAncorada>;
}

/** O tour do texto e do PDF, na primeira abertura de um deles. */
export function TourDoLeitor({ situacao, pdf, ir, atrasoMs }: { situacao: SituacaoDasMarcas; pdf: boolean; ir: (destino: Rota) => void; atrasoMs?: number }): ReactNode {
  return <TourGuiado tour="texto" dicas={dicasDoTour(situacao, pdf)} ir={ir} {...(atrasoMs === undefined ? {} : { atrasoMs })} />;
}

/** O tour do vídeo e do áudio, na primeira abertura de um deles. */
export function TourDoPlayer({ video, ir, atrasoMs }: { video: boolean; ir: (destino: Rota) => void; atrasoMs?: number }): ReactNode {
  return <TourGuiado tour="video" dicas={dicasDoPlayer(video)} ir={ir} {...(atrasoMs === undefined ? {} : { atrasoMs })} />;
}

/** O tour do quadro, na primeira abertura de um quadro. */
export function TourDoQuadro({ ir, atrasoMs }: { ir: (destino: Rota) => void; atrasoMs?: number }): ReactNode {
  return <TourGuiado tour="quadro" dicas={dicasDoQuadro()} ir={ir} {...(atrasoMs === undefined ? {} : { atrasoMs })} />;
}
