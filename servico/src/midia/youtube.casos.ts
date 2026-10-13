/** Legendas `json3` de exemplo para os testes da importação do YouTube (J109); nenhuma veio da rede. */

/** Legenda automática no `json3` do YouTube: um evento por linha, uma palavra por segmento (com deslocamento). */
export const LEGENDA_AUTOMATICA = {
  wireMagic: 'pb3',
  events: [
    { tStartMs: 0, dDurationMs: 4000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
    { tStartMs: 160, dDurationMs: 3200, wWinId: 1, segs: [{ utf8: 'a', acAsrConf: 0 }, { utf8: ' China', tOffsetMs: 240 }, { utf8: ' fez', tOffsetMs: 720 }, { utf8: ' uma', tOffsetMs: 960 }] },
    { tStartMs: 1600, dDurationMs: 30, aAppend: 1, wWinId: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 1620, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: '[Música]' }] },
    { tStartMs: 3800, dDurationMs: 1400, wWinId: 1, segs: [{ utf8: 'jogada' }, { utf8: ' de', tOffsetMs: 400 }, { utf8: ' mestre', tOffsetMs: 600 }] },
  ],
};

/** Legenda escrita pelo canal: o segmento é a fala inteira. */
export const LEGENDA_DO_CANAL = {
  events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: '>> A China fez' }] },
    { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: '(risos) uma jogada.' }] },
  ],
};

