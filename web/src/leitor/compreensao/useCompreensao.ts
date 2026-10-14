/**
 * Liga o leitor à compreensão do capítulo (J31, `docs/desenho/10-MODELO-DO-CAPITULO.md`).
 *
 * A compreensão fica ativa quando a camada escolhida no leitor é a de uma execução de compreensão
 * (`compreensaoDaCamada`).
 * Ao abrir um capítulo ainda não preparado, pede a preparação dele e do seguinte (prefetch) e
 * acompanha o estado até ficar pronto: o leitor vê só "Preparando… / Pronto / Falhou".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModeloDoCapituloV1, PlanoPedagogicoV1 } from '@margem/contratos';
import { capituloDaCompreensao, prepararCapituloDaCompreensao, type EstadoVisivelDaCompreensao } from '../../biblioteca/api';
import type { CamadaResumida } from '../f2';

export interface FontesDaCompreensao {
  capitulo: typeof capituloDaCompreensao;
  preparar: typeof prepararCapituloDaCompreensao;
}
export const FONTES_DA_COMPREENSAO: FontesDaCompreensao = { capitulo: capituloDaCompreensao, preparar: prepararCapituloDaCompreensao };

/** A camada escolhida, quando é a de uma compreensão; `null` em qualquer outro caso (nada é buscado). */
export function compreensaoDaCamada(camada: string | undefined, camadas: readonly CamadaResumida[] | undefined): string | null {
  return camada !== undefined && (camadas ?? []).some((item) => item.id === camada && item.compreensao === true) ? camada : null;
}

export interface EstadoDaCompreensao {
  /** Id da execução de compreensão ativa (a camada escolhida), ou `null`. */
  ativa: string | null;
  visivel: EstadoVisivelDaCompreensao | null;
  modelo: ModeloDoCapituloV1 | null;
  plano: PlanoPedagogicoV1 | null;
  erro: string | null;
  preparar: () => void;
}

/** Intervalo entre consultas enquanto o capítulo prepara. */
export const INTERVALO_DE_CONSULTA_MS = 15_000;

export function useCompreensao(
  ativa: string | null, secaoId: string, fontes: FontesDaCompreensao = FONTES_DA_COMPREENSAO, intervaloMs = INTERVALO_DE_CONSULTA_MS,
): EstadoDaCompreensao {
  const [visivel, definirVisivel] = useState<EstadoVisivelDaCompreensao | null>(null);
  const [modelo, definirModelo] = useState<ModeloDoCapituloV1 | null>(null);
  const [plano, definirPlano] = useState<PlanoPedagogicoV1 | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const pedidos = useRef(new Set<string>());
  // Um novo pedido (tentar de novo) reinicia o acompanhamento.
  const [rodada, novaRodada] = useState(0);

  const consultar = useCallback(async (execucao: string): Promise<EstadoVisivelDaCompreensao> => {
    const detalhe = await fontes.capitulo(execucao, secaoId);
    definirVisivel(detalhe.visivel);
    definirModelo(detalhe.modelo);
    definirPlano(detalhe.plano);
    return detalhe.visivel;
  }, [fontes, secaoId]);

  const preparar = useCallback(() => {
    if (ativa === null) return;
    definirErro(null);
    // "Tentar de novo": os jobs do capítulo que falharam voltam à fila antes de a preparação avançar.
    fontes.preparar(ativa, secaoId, true, true).then((resposta) => { definirVisivel(resposta.visivel); novaRodada((atual) => atual + 1); }, (falha: unknown) => {
      definirErro(falha instanceof Error ? falha.message : 'Não foi possível preparar o capítulo.');
    });
  }, [ativa, fontes, secaoId]);

  useEffect(() => {
    definirVisivel(null); definirModelo(null); definirPlano(null); definirErro(null);
    if (ativa === null) return undefined;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const ciclo = async (): Promise<void> => {
      try {
        let estado = await consultar(ativa);
        const chave = `${ativa}:${secaoId}`;
        if (vivo && (estado === 'nao_preparado' || estado === 'pronto') && !pedidos.current.has(chave)) {
          // Abrir o capítulo pede a preparação dele e do seguinte; pronto, só o prefetch do seguinte.
          pedidos.current.add(chave);
          const resposta = await fontes.preparar(ativa, secaoId, true);
          if (estado === 'nao_preparado') { estado = resposta.visivel; definirVisivel(estado); }
        }
        if (vivo && estado === 'preparando') relogio = setTimeout(() => { void ciclo(); }, intervaloMs);
      } catch (falha) {
        if (vivo) definirErro(falha instanceof Error ? falha.message : 'Não foi possível consultar a compreensão.');
      }
    };
    void ciclo();
    return () => { vivo = false; if (relogio !== undefined) clearTimeout(relogio); };
  }, [ativa, secaoId, consultar, fontes, intervaloMs, rodada]);

  return { ativa, visivel, modelo, plano, erro, preparar };
}
