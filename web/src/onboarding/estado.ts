/**
 * Estado dos primeiros passos (onboarding), puro: sem React, sem armazenamento.
 *
 * Etapas: boas-vindas (quatro telas, pulável), primeiro documento (importado ou o exemplo), as dicas
 * de cada tipo (texto, vídeo e quadro, cada uma na primeira abertura de um item daquele tipo) e
 * "leve o Margem com você". Cada etapa pode ser pulada e reaberta pelo "Primeiros passos". O formato
 * guardado tem `versao`; o da versão 1 (um tour só, de texto) migra sem rever o que já foi visto; dado
 * desconhecido volta ao inicial, campo a campo, sem nunca quebrar a abertura do app.
 */

export const VERSAO_DO_ONBOARDING = 2;

/** Número de telas das boas-vindas: o que é, os três jeitos de estudar, como se lê, o primeiro exemplo. */
export const TELAS_DAS_BOAS_VINDAS = 4;

/** Os tours, um por jeito de estudar: ler (texto e PDF), assistir (vídeo e áudio) e observar (quadro). */
export type TipoDeTour = 'texto' | 'video' | 'quadro';
export const TIPOS_DE_TOUR: readonly TipoDeTour[] = ['texto', 'video', 'quadro'];

export type EstadoDaEtapa = 'pendente' | 'concluida' | 'pulada';
export type OrigemDoPrimeiroDocumento = 'importado' | 'exemplo' | 'uso_anterior';

export interface EstadoDoOnboarding {
  versao: typeof VERSAO_DO_ONBOARDING;
  boas_vindas: EstadoDaEtapa;
  /** Tela das boas-vindas em que a pessoa parou (0 a TELAS_DAS_BOAS_VINDAS − 1). */
  tela: number;
  primeiro_documento: { estado: EstadoDaEtapa; origem: OrigemDoPrimeiroDocumento | null; documento_id: string | null };
  /** O documento de exemplo, quando já foi adicionado: abrir de novo não o duplica. */
  exemplo_id: string | null;
  tours: Record<TipoDeTour, EstadoDaEtapa>;
  /** Dica de cada tour em que a pessoa parou. */
  dicas: Record<TipoDeTour, number>;
  levar: EstadoDaEtapa;
  /** `null` até a primeira gravação: distingue "nunca abriu" de "abriu e pulou tudo". */
  atualizado_em: string | null;
}

export const ONBOARDING_INICIAL: EstadoDoOnboarding = {
  versao: VERSAO_DO_ONBOARDING,
  boas_vindas: 'pendente', tela: 0,
  primeiro_documento: { estado: 'pendente', origem: null, documento_id: null },
  exemplo_id: null,
  tours: { texto: 'pendente', video: 'pendente', quadro: 'pendente' },
  dicas: { texto: 0, video: 0, quadro: 0 },
  levar: 'pendente',
  atualizado_em: null,
};

export type AcaoDoOnboarding =
  | { tipo: 'avancar_tela' }
  | { tipo: 'voltar_tela' }
  | { tipo: 'pular_boas_vindas' }
  | { tipo: 'concluir_boas_vindas' }
  | { tipo: 'rever_boas_vindas' }
  | { tipo: 'registrar_documento'; origem: Exclude<OrigemDoPrimeiroDocumento, 'uso_anterior'>; documento_id: string }
  | { tipo: 'esquecer_exemplo' }
  | { tipo: 'pular_primeiro_documento' }
  | { tipo: 'avancar_dica'; tour: TipoDeTour; total: number }
  | { tipo: 'voltar_dica'; tour: TipoDeTour }
  | { tipo: 'pular_tour'; tour: TipoDeTour }
  | { tipo: 'concluir_tour'; tour: TipoDeTour }
  | { tipo: 'rever_tour'; tour: TipoDeTour }
  | { tipo: 'concluir_levar' }
  | { tipo: 'pular_levar' }
  /** Quem já tinha textos antes do onboarding existir não é recebido como estreante. */
  | { tipo: 'dispensar_por_uso_anterior' }
  | { tipo: 'recomecar' };

const limitar = (valor: number, minimo: number, maximo: number) => Math.max(minimo, Math.min(maximo, valor));

/** Aplica uma ação. `agora` entra de fora para o redutor continuar puro (e testável). */
export function reduzirOnboarding(estado: EstadoDoOnboarding, acao: AcaoDoOnboarding, agora: string): EstadoDoOnboarding {
  const proximo = aplicar(estado, acao);
  return proximo === estado ? estado : { ...proximo, atualizado_em: agora };
}

function aplicar(e: EstadoDoOnboarding, acao: AcaoDoOnboarding): EstadoDoOnboarding {
  switch (acao.tipo) {
    case 'avancar_tela':
      return e.tela >= TELAS_DAS_BOAS_VINDAS - 1 ? { ...e, boas_vindas: 'concluida' } : { ...e, tela: e.tela + 1 };
    case 'voltar_tela':
      return e.tela === 0 ? e : { ...e, tela: e.tela - 1 };
    case 'pular_boas_vindas':
      return { ...e, boas_vindas: e.boas_vindas === 'concluida' ? 'concluida' : 'pulada' };
    case 'concluir_boas_vindas':
      return { ...e, boas_vindas: 'concluida' };
    case 'rever_boas_vindas':
      return { ...e, boas_vindas: 'pendente', tela: 0 };
    case 'registrar_documento': {
      // O primeiro documento conta uma vez; o exemplo é lembrado sempre, para não duplicar.
      const primeiro = e.primeiro_documento.estado === 'concluida' ? e.primeiro_documento
        : { estado: 'concluida' as const, origem: acao.origem, documento_id: acao.documento_id };
      // As boas-vindas não se fecham aqui: com o exemplo, elas mostram a preparação do texto até ele abrir.
      return { ...e, primeiro_documento: primeiro, exemplo_id: acao.origem === 'exemplo' ? acao.documento_id : e.exemplo_id };
    }
    case 'esquecer_exemplo':
      return e.exemplo_id === null ? e : { ...e, exemplo_id: null };
    case 'pular_primeiro_documento':
      return e.primeiro_documento.estado === 'pendente' ? { ...e, primeiro_documento: { ...e.primeiro_documento, estado: 'pulada' } } : e;
    case 'avancar_dica': {
      const dica = e.dicas[acao.tour];
      return dica >= acao.total - 1 ? comTour(e, acao.tour, 'concluida') : { ...e, dicas: { ...e.dicas, [acao.tour]: dica + 1 } };
    }
    case 'voltar_dica':
      return e.dicas[acao.tour] === 0 ? e : { ...e, dicas: { ...e.dicas, [acao.tour]: e.dicas[acao.tour] - 1 } };
    case 'pular_tour':
      return comTour(e, acao.tour, e.tours[acao.tour] === 'concluida' ? 'concluida' : 'pulada');
    case 'concluir_tour':
      return comTour(e, acao.tour, 'concluida');
    case 'rever_tour':
      return comTour(e, acao.tour, 'pendente');
    case 'concluir_levar':
      return e.levar === 'concluida' ? e : { ...e, levar: 'concluida' };
    case 'pular_levar':
      return e.levar === 'pendente' ? { ...e, levar: 'pulada' } : e;
    case 'dispensar_por_uso_anterior':
      if (e.atualizado_em !== null) return e;
      return { ...e, boas_vindas: 'pulada', tours: { texto: 'pulada', video: 'pulada', quadro: 'pulada' },
        primeiro_documento: { estado: 'concluida', origem: 'uso_anterior', documento_id: null } };
    case 'recomecar':
      return { ...ONBOARDING_INICIAL, exemplo_id: e.exemplo_id };
  }
}

/** Um tour muda de estado e volta à primeira dica. */
function comTour(e: EstadoDoOnboarding, tour: TipoDeTour, estado: EstadoDaEtapa): EstadoDoOnboarding {
  return { ...e, tours: { ...e.tours, [tour]: estado }, dicas: { ...e.dicas, [tour]: 0 } };
}

/**
 * Reconstrói só os campos conhecidos; o que vier inválido assume o valor inicial. A versão 1 tinha um
 * tour só (o do leitor de texto): ele vira o de texto, e os de vídeo e quadro ficam por ver, na
 * primeira abertura de cada tipo. As boas-vindas já vistas continuam vistas.
 */
export function validarOnboarding(valor: unknown): EstadoDoOnboarding {
  if (typeof valor !== 'object' || valor === null) return { ...ONBOARDING_INICIAL };
  const v = valor as Record<string, unknown>;
  if (v['versao'] !== VERSAO_DO_ONBOARDING && v['versao'] !== 1) return { ...ONBOARDING_INICIAL };
  const v1 = v['versao'] === 1;
  const etapa = (chave: unknown): EstadoDaEtapa => chave === 'concluida' || chave === 'pulada' ? chave : 'pendente';
  const id = (chave: unknown): string | null => typeof chave === 'string' && /^[0-9A-Za-z]{1,64}$/.test(chave) ? chave : null;
  const inteiro = (chave: unknown, maximo: number) => typeof chave === 'number' && Number.isInteger(chave) ? limitar(chave, 0, maximo) : 0;
  const registro = (campo: unknown): Record<string, unknown> => typeof campo === 'object' && campo !== null ? campo as Record<string, unknown> : {};
  const bruto = registro(v['primeiro_documento']);
  const origem = bruto['origem'];
  return {
    versao: VERSAO_DO_ONBOARDING,
    boas_vindas: etapa(v['boas_vindas']),
    tela: inteiro(v['tela'], TELAS_DAS_BOAS_VINDAS - 1),
    primeiro_documento: {
      estado: etapa(bruto['estado']),
      origem: origem === 'importado' || origem === 'exemplo' || origem === 'uso_anterior' ? origem : null,
      documento_id: id(bruto['documento_id']),
    },
    exemplo_id: id(v['exemplo_id']),
    tours: v1 ? { texto: etapa(v['tour']), video: 'pendente', quadro: 'pendente' } : {
      texto: etapa(registro(v['tours'])['texto']), video: etapa(registro(v['tours'])['video']), quadro: etapa(registro(v['tours'])['quadro']),
    },
    dicas: v1 ? { texto: inteiro(v['dica'], 20), video: 0, quadro: 0 } : {
      texto: inteiro(registro(v['dicas'])['texto'], 20), video: inteiro(registro(v['dicas'])['video'], 20), quadro: inteiro(registro(v['dicas'])['quadro'], 20),
    },
    levar: etapa(v['levar']),
    atualizado_em: typeof v['atualizado_em'] === 'string' && !Number.isNaN(Date.parse(v['atualizado_em'])) ? v['atualizado_em'] : null,
  };
}

export type NomeDaEtapa = 'boas_vindas' | 'primeiro_documento' | 'tour_texto' | 'tour_video' | 'tour_quadro' | 'levar';
export interface Etapa { nome: NomeDaEtapa; estado: EstadoDaEtapa }

/** As etapas, na ordem em que o "Primeiros passos" as mostra. Sem a arte, não há tour do quadro. */
export function etapas(e: EstadoDoOnboarding, opcoes: { quadros?: boolean } = {}): Etapa[] {
  return [
    { nome: 'boas_vindas' as const, estado: e.boas_vindas },
    { nome: 'primeiro_documento' as const, estado: e.primeiro_documento.estado },
    { nome: 'tour_texto' as const, estado: e.tours.texto },
    { nome: 'tour_video' as const, estado: e.tours.video },
    ...(opcoes.quadros === false ? [] : [{ nome: 'tour_quadro' as const, estado: e.tours.quadro }]),
    { nome: 'levar' as const, estado: e.levar },
  ];
}

/** A primeira etapa ainda pendente, ou `null` quando tudo foi visto ou pulado. */
export function proximaEtapa(e: EstadoDoOnboarding): NomeDaEtapa | null {
  return etapas(e).find((etapa) => etapa.estado === 'pendente')?.nome ?? null;
}

/** Quantas etapas foram concluídas (as puladas não contam). */
export function concluidas(e: EstadoDoOnboarding, opcoes: { quadros?: boolean } = {}): number {
  return etapas(e, opcoes).filter((etapa) => etapa.estado === 'concluida').length;
}

/** As boas-vindas aparecem sozinhas só enquanto estão pendentes e fora do leitor. */
export function mostrarBoasVindas(e: EstadoDoOnboarding, lendo: boolean): boolean {
  return e.boas_vindas === 'pendente' && !lendo;
}

/** O tour de cada tipo aparece na abertura de um item daquele tipo enquanto estiver pendente. */
export function mostrarTour(e: EstadoDoOnboarding, tour: TipoDeTour): boolean {
  return e.tours[tour] === 'pendente';
}
