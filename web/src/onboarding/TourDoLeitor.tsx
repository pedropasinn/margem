import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { DicaAncorada } from './DicaAncorada';
import { mostrarTour } from './estado';

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
          ? <p>O Margem está lendo este texto agora. Quando a leitura terminar, os trechos importantes ganham cores pela função que cumprem (tese, conceito, justificativa…). Pode começar a ler: as marcas aparecem por cima, sem mexer no texto.</p>
          : <p>Este texto ainda não tem marcas. Elas chegam quando você pede <strong>Preparar leitura</strong> na página do documento: o Margem lê o texto e marca cada trecho importante pela função que cumpre (tese, conceito, justificativa…).</p> },
    { id: 'margem', titulo: 'Notas na margem', alvos: ['.margem .nota .nota-numero', '.numero-lateral', '.margem'],
      texto: <p>Ao lado de cada marca, na altura do trecho, uma nota curta diz por que ele importa. Passe o mouse para ligar nota e trecho; clique para abrir o fio, as fontes e as conexões. Em telas estreitas, os números na lateral abrem a nota numa folha.</p> },
    { id: 'aparencia', titulo: 'Do seu jeito', alvos: ['.aparencia > .botao-da-barra', 'button[aria-label^="Atenção"]'],
      texto: <p><strong>Aa</strong> muda tema, tamanho, entrelinha, largura e o estilo das marcas (grifo, marca-texto ou sublinhado). Ao lado, <strong>Atenção</strong> escolhe quantas marcas aparecem, do texto limpo ao estudo aprofundado.</p> },
    { id: 'perguntar', titulo: 'Pergunte ao texto', alvos: [pdf ? '.pdf-pagina' : '.capitulo p[data-bloco]'],
      texto: <p>Selecione uma passagem: aparece <strong>Anotar · Perguntar · Conectar</strong>. A pergunta abre uma conversa curta presa ao trecho; conectar liga a passagem a outra, deste ou de outro texto.</p> },
    { id: 'retomada', titulo: 'Retome de onde parou', alvos: ['.voltar-da-barra', '.barra-do-leitor'],
      texto: <p>O Margem guarda o capítulo e a posição enquanto você lê. Ao voltar, o texto abre onde você parou, e o Início mostra o que está em andamento em <strong>Continuar lendo</strong>.</p> },
  ];
}

/**
 * Tour leve na primeira abertura de um texto. Espera o leitor assentar (as marcas e a margem são
 * medidas depois do primeiro desenho) antes de mostrar a primeira dica.
 */
export function TourDoLeitor({ situacao, pdf, ir, atrasoMs = 700 }: { situacao: SituacaoDasMarcas; pdf: boolean; ir: (destino: Rota) => void; atrasoMs?: number }): ReactNode {
  const { estado, despachar, ativo, pronto } = usarOnboarding();
  const deveMostrar = ativo && pronto && estado.boas_vindas !== 'pendente' && mostrarTour(estado);
  const [assentado, assentar] = useState(atrasoMs === 0);
  useEffect(() => {
    if (!deveMostrar || assentado) return;
    const espera = setTimeout(() => assentar(true), atrasoMs);
    return () => clearTimeout(espera);
  }, [deveMostrar, assentado, atrasoMs]);
  if (!deveMostrar || !assentado) return null;
  const dicas = dicasDoTour(situacao, pdf);
  const passo = Math.min(estado.dica, dicas.length - 1);
  const dica = dicas[passo]!;
  const ultima = passo === dicas.length - 1;
  return <DicaAncorada key={dica.id} alvos={dica.alvos} titulo={dica.titulo} passo={passo} total={dicas.length}
    aoAvancar={() => despachar({ tipo: 'avancar_dica', total: dicas.length })}
    aoVoltar={() => despachar({ tipo: 'voltar_dica' })}
    aoFechar={() => despachar({ tipo: 'pular_tour' })}
    extra={ultima && estado.levar === 'pendente' ? <p className="dica-extra"><Button variante="ghost" className="small" onClick={() => { despachar({ tipo: 'concluir_tour' }); ir({ nome: 'primeiros-passos' }); }}>
      <Icon name="celular" size={16} /> Leve o Margem com você</Button></p> : undefined}>
    {dica.texto}
  </DicaAncorada>;
}
