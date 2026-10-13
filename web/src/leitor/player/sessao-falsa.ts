/** Media Session determinística para os testes dos players. */
export function sessaoFalsa() {
  const acoes = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  return {
    acoes,
    metadata: null as MediaMetadata | null,
    playbackState: 'none' as MediaSessionPlaybackState,
    posicao: undefined as MediaPositionState | undefined,
    setActionHandler: (acao: MediaSessionAction, executar: MediaSessionActionHandler | null) => { acoes.set(acao, executar); },
    setPositionState(posicao?: MediaPositionState) { this.posicao = posicao; },
    executar(acao: MediaSessionAction, detalhes: Partial<MediaSessionActionDetails> = {}) { acoes.get(acao)?.({ action: acao, ...detalhes }); },
  };
}
export class MetadadosFalsos {
  constructor(dados: MediaMetadataInit) { Object.assign(this, dados); }
}
