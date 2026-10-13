import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { corDaFuncao, desenhaMarca, pesoDaSaliencia, type MarcaDoLeitor, type TracoPessoal } from '../../leitor/f2';
import { usarFuncoes } from '../../leitor/ContextoDosModos';
import { intervaloDoOffset } from '../../leitor/posicao';
import { APARENCIA_PADRAO, rugosidadeDoTraco, type Preferencias } from '../../leitor/preferencias';
import { retangulosDosTrechos, retangulosDoIntervalo } from './geometria';
import { Desenho } from './Desenho';
import { tracos, type Retangulo } from './tracos';
import type { GuiaDoPasso } from '../../leitor/tipos';

const SEM_TRACOS: readonly TracoPessoal[] = [];
/** O traço de cada estilo; a saliência 3 (só sublinhado) vale em qualquer um. */
export function acaoDoEstilo(estilo: Preferencias['estilo'], soSublinhado: boolean): 'grifo' | 'marca_texto' | 'sublinhado' {
  if (soSublinhado || estilo === 'sublinhado') return 'sublinhado';
  return estilo === 'marca_texto' ? 'marca_texto' : 'grifo';
}
/** Na leitura guiada, a marca fora do passo recua para um quarto da força; as do passo ficam inteiras. */
export const recuoNoGuia = (guia: GuiaDoPasso | null | undefined, id: string): number => !guia || guia.marcas.includes(id) ? 1 : .25;
interface Medida { marca: MarcaDoLeitor; linhas: Retangulo[] }
export function CamadaDeMarcas({ artigo, marcas, ativa: ativaDoLeitor = null, preferencias = APARENCIA_PADRAO, pessoais = SEM_TRACOS, guia = null }: {
  artigo: RefObject<HTMLElement>; marcas: readonly MarcaDoLeitor[]; ativa?: string | null; preferencias?: Preferencias; pessoais?: readonly TracoPessoal[]; guia?: GuiaDoPasso | null;
}): ReactNode {
  const ativa = guia?.ativa ?? ativaDoLeitor;
  const { modos, escuro } = usarFuncoes();
  const [medidasPessoais, definirPessoais] = useState<{ traco: TracoPessoal; linhas: Retangulo[] }[]>([]);
  const [medidas, definirMedidas] = useState<Medida[]>([]);
  useEffect(() => {
    const elemento = artigo.current;
    if (!elemento) return;
    let vivo = true;
    const medir = () => {
      if (!vivo) return;
      const base = elemento.getBoundingClientRect();
      definirPessoais(pessoais.map((traco) => {
        const recortes = [...elemento.querySelectorAll<HTMLElement>(`[data-recorte-bloco="${traco.ancora.bloco_id}"]`)];
        const linhas = (recortes.length ? recortes : [elemento]).flatMap((regiao) => {
          const inicio = intervaloDoOffset(regiao, traco.ancora.bloco_id, traco.ancora.inicio_utf16);
          const fim = intervaloDoOffset(regiao, traco.ancora.bloco_id, traco.ancora.fim_utf16);
          if (!inicio || !fim) return [];
          inicio.setEnd(fim.startContainer, fim.startOffset);
          return retangulosDoIntervalo(inicio, base);
        });
        return { traco, linhas };
      }));
      const porId = new Map<string, Element[]>();
      for (const span of elemento.querySelectorAll<HTMLElement>('span[data-marcas]')) {
        for (const id of (span.dataset['marcas'] ?? '').split(' ')) {
          const lista = porId.get(id) ?? [];
          lista.push(span);
          porId.set(id, lista);
        }
      }
      definirMedidas(marcas.filter((m) => m.visivel && m.avaliacao !== 'rejeitada' && m.validade === 'resolvida').map((marca) => {
        const spans = (porId.get(marca.id) ?? []).filter((s) => !s.hasAttribute('data-editorial') || s.getAttribute('data-editorial') === marca.id || marca.funcao === 'nenhuma');
        return { marca, linhas: retangulosDosTrechos(spans, base) };
      }));
    };
    medir();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observador?.observe(elemento);
    window.addEventListener('resize', medir);
    void document.fonts?.ready.then(medir);
    return () => { vivo = false; observador?.disconnect(); window.removeEventListener('resize', medir); };
    // Ativação e cor só redesenham caminhos; não provocam leituras de layout.
  }, [artigo, marcas, pessoais, preferencias.tamanho, preferencias.medida, preferencias.entrelinha, preferencias.alinhamento, preferencias.espacamento]);
  const caminhosEmRepouso = useMemo(() => new Map(medidas.map(({ marca, linhas }) => {
    const peso = pesoDaSaliencia(marca);
    const cor = corDaFuncao(marca.funcao, 'modo' in marca ? marca.modo : undefined, modos, preferencias, escuro);
    return [marca.id, !desenhaMarca(marca) || preferencias.estilo === 'margem' ? [] : tracos(linhas, {
      cor, semente: marca.id, rugosidade: rugosidadeDoTraco(preferencias),
      acao: acaoDoEstilo(preferencias.estilo, peso.soSublinhado), espessura: peso.espessura,
    })];
  })), [medidas, modos, preferencias, escuro]);
  return (
    <svg className="camada-de-marcas" aria-hidden="true">
      {preferencias.estilo !== 'margem' && medidas.map(({ marca, linhas }) => {
        const cor = corDaFuncao(marca.funcao, 'modo' in marca ? marca.modo : undefined, modos, preferencias, escuro);
        const opcoes = { cor, semente: marca.id, rugosidade: rugosidadeDoTraco(preferencias) };
        const peso = pesoDaSaliencia(marca);
        const caminhos = ativa !== marca.id ? caminhosEmRepouso.get(marca.id) ?? [] : !desenhaMarca(marca) ? [] : tracos(linhas, {
          ...opcoes, acao: acaoDoEstilo(preferencias.estilo, peso.soSublinhado),
          espessura: ativa === marca.id ? peso.espessura * 1.6 : peso.espessura,
        });
        // As subfaixas (qualificadores como “por ora”, “somente”) ficam só nos dados: não se desenham.
        // A marca ativa não ganha moldura: fica mais forte (intensidade e linha de base mais grossa).
        const intensidade = preferencias.intensidade + (ativa === marca.id ? .12 : ativa ? -.08 : 0);
        // Mesmo branco sobre #141414 mantém 4,8:1 no limite de 40% em screen.
        const opacidade = Math.max(0, Math.min(escuro ? .4 : 1, intensidade * (escuro ? .6 : 1) * peso.fator)) * recuoNoGuia(guia, marca.id);
        return linhas.length > 0 && <Desenho key={marca.id} id={marca.id} caminhos={caminhos}
          opacidade={opacidade} animacao={preferencias.animacao} />;
      })}
      {medidasPessoais.map(({ traco, linhas }) => <Desenho key={traco.id} id={traco.id} animacao={false}
        caminhos={tracos(linhas, traco.dificuldade === true
          ? { acao: 'sublinhado', cor: 'var(--aviso-texto)', semente: traco.id, espessura: 1.6, recuo: 1, rugosidade: 0, tracejado: true }
          : { acao: traco.acao, cor: 'var(--texto-2)', semente: traco.id, espessura: 1.2, recuo: 1 })}
        opacidade={traco.dificuldade === true ? .6 : .5} />)}
    </svg>
  );
}
