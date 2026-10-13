/** Execuções falsas para a galeria de UI e os testes: nenhuma vem do serviço. */
import type { ExecucoesDoCodexV1 } from '@margem/contratos';

const D = '01K0000000000000000000D001';
const S = '01K0000000000000000000S003';

export function listaDeExemplo(agora: number): ExecucoesDoCodexV1 {
  const antes = (segundos: number) => new Date(agora - segundos * 1000).toISOString();
  const documento = { id: D, titulo: 'Mixtape' };
  const secao = { id: S, titulo: 'O meio', numero: 3 };
  return {
    versao: 1, gerado_em: new Date(agora).toISOString(), omitidas: 4,
    execucoes: [
      { id: '01K0000000000000000000J001', tipo: 'ler_parte', rotulo: 'Lendo o capítulo 3 de Mixtape', estado: 'rodando',
        inicio: antes(65), fim: null, documento, secao, rota: `/ler/${D}/${S}`, mensagem: null },
      { id: '01K0000000000000000000J002', tipo: 'gerar_esquema', rotulo: 'Montando o mapa do capítulo 3 de Mixtape', estado: 'concluida',
        inicio: antes(50), fim: antes(4), documento, secao, rota: `/ler/${D}/${S}`, mensagem: null },
      { id: '01K0000000000000000000J003', tipo: 'revisar_anotacao', rotulo: 'Revisando sua nota', estado: 'falhou',
        inicio: antes(40), fim: antes(8), documento, secao, rota: `/ler/${D}/${S}`, mensagem: 'O Codex demorou demais e parou.' },
      { id: '01K0000000000000000000J004', tipo: 'responder', rotulo: 'Respondendo à sua pergunta', estado: 'rodando',
        inicio: antes(12), fim: null, documento, secao, rota: `/ler/${D}/${S}`, mensagem: null },
      { id: '01K0000000000000000000J005', tipo: 'sintetizar_capitulo', rotulo: 'Resumindo o capítulo 4 de Mixtape', estado: 'na_fila',
        inicio: antes(30), fim: null, documento, secao: { id: '01K0000000000000000000S004', titulo: 'O fim', numero: 4 },
        rota: `/ler/${D}/01K0000000000000000000S004`, mensagem: null },
    ],
  };
}
