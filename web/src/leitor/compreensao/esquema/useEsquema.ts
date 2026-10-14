/**
 * O esquema do capítulo na interface: lê o estado ao abrir o mapa, pede (gerar / gerar de novo) e
 * acompanha a geração, relendo a cada poucos segundos só enquanto ela está em curso.
 */
import { useCallback, useEffect, useState } from 'react';
import { esquemaDoCapitulo, gerarEsquema, type SituacaoDoEsquema } from '../../../biblioteca/api';
import { apagarMapa } from '../../../apagar/api';

export interface FontesDoEsquema { ler: typeof esquemaDoCapitulo; gerar: typeof gerarEsquema; apagar?: typeof apagarMapa }
export const FONTES_DO_ESQUEMA: FontesDoEsquema = { ler: esquemaDoCapitulo, gerar: gerarEsquema, apagar: apagarMapa };
export const INTERVALO_DO_ESQUEMA_MS = 4000;

export interface EstadoDoUsoDoEsquema {
  situacao: SituacaoDoEsquema | null;
  erro: string | null;
  /** Um pedido acabou de ser enviado (antes da resposta). */
  pedindo: boolean;
  gerar: () => void;
  /** V-T8: `soPedido` cancela o mapa sendo gerado (o pronto fica); sem ele, apaga o mapa. Rejeita se falhar. */
  apagar: (soPedido: boolean) => Promise<void>;
}

export const emCurso = (situacao: SituacaoDoEsquema | null): boolean => situacao?.estado === 'pendente' || situacao?.estado === 'executando';

export function useEsquema(compreensaoId: string, secaoId: string, fontes: FontesDoEsquema = FONTES_DO_ESQUEMA, intervaloMs = INTERVALO_DO_ESQUEMA_MS): EstadoDoUsoDoEsquema {
  const [situacao, definir] = useState<SituacaoDoEsquema | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [pedindo, definirPedindo] = useState(false);

  useEffect(() => {
    let vivo = true;
    definir(null); definirErro(null);
    fontes.ler(compreensaoId, secaoId).then((lida) => { if (vivo) definir(lida); }, (falha: unknown) => {
      if (vivo) definirErro(falha instanceof Error ? falha.message : 'Não foi possível ler o mapa.');
    });
    return () => { vivo = false; };
  }, [compreensaoId, secaoId, fontes]);

  const andando = emCurso(situacao);
  useEffect(() => {
    if (!andando) return undefined;
    let vivo = true;
    const relogio = setInterval(() => {
      fontes.ler(compreensaoId, secaoId).then((lida) => { if (vivo) definir(lida); }, () => undefined);
    }, intervaloMs);
    return () => { vivo = false; clearInterval(relogio); };
  }, [andando, compreensaoId, secaoId, fontes, intervaloMs]);

  const gerar = useCallback(() => {
    definirErro(null); definirPedindo(true);
    fontes.gerar(compreensaoId, secaoId).then((resposta) => { definir(resposta); definirPedindo(false); }, (falha: unknown) => {
      definirPedindo(false);
      definirErro(falha instanceof Error ? falha.message : 'Não foi possível pedir o mapa.');
    });
  }, [compreensaoId, secaoId, fontes]);

  const apagar = useCallback(async (soPedido: boolean) => {
    definirErro(null);
    if (!fontes.apagar) return;
    await fontes.apagar(compreensaoId, secaoId, soPedido);
    definir(await fontes.ler(compreensaoId, secaoId));
  }, [compreensaoId, secaoId, fontes]);

  return { situacao, erro, pedindo, gerar, apagar };
}
