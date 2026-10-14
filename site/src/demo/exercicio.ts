/**
 * A sessão de resolução da demonstração de exercícios, no formato que o app recebe de
 * `GET /api/resolucoes/:id` (`SessaoDaApi` com uma `ResolucaoV2`): a questão colada como print vira
 * um PDF de uma página e a resolução da página inteira (`origem: recorte`, página 1, retângulo 0,0,1,1),
 * como no J119. Questão, resolução e conversa são originais, escritas para a página, com a matemática
 * em `$…$`/`$$…$$` como o modelo escreve (o app desenha com o KaTeX). O print é `public/demo/questao.png`
 * (`scripts/gerar-print-da-questao.mjs`).
 */
import type { SessaoDaApi } from '@app/biblioteca/api';

export const ID_DA_SESSAO = '01K7DEMOEXERCICIO000000001';
export const PRINT_DA_QUESTAO = '/demo/questao.png';

export const SESSAO: SessaoDaApi = {
  estado: 'pronta',
  resolucao: {
    versao: 2,
    id: ID_DA_SESSAO,
    documento_id: '01K7DEMODOCUMENTO000000001',
    versao_id: '01K7DEMOVERSAO00000000001',
    origem: { tipo: 'recorte', pagina: 1, retangulo: { x: 0, y: 0, largura: 1, altura: 1 }, imagem_sha256: '0'.repeat(64) },
    texto_extraido: '',
    resolucao: {
      enunciado: '7. Calcule as integrais.\n(a) $\\int_0^1 x\\,e^x\\,dx$\n(b) $\\int x\\ln x\\,dx$, para $x > 0$.',
      legibilidade: 'boa',
      itens: [
        {
          rotulo: 'a',
          enunciado: '$\\int_0^1 x\\,e^x\\,dx$',
          estrategia: 'Integração por partes com $u = x$ e $dv = e^x\\,dx$: derivar $x$ simplifica o integrando, e $e^x$ não muda ao integrar.',
          passos: [
            { texto: 'Com $du = dx$ e $v = e^x$, a fórmula $\\int u\\,dv = uv - \\int v\\,du$ dá', calculo: '$$\\int x\\,e^x\\,dx = x\\,e^x - \\int e^x\\,dx = (x - 1)\\,e^x + C$$' },
            { texto: 'Nos limites de $0$ a $1$:', calculo: '$$\\Big[(x - 1)\\,e^x\\Big]_0^1 = 0 - (-1) = 1$$' },
            { texto: '$\\int_0^1 x\\,e^x\\,dx = 1$.', calculo: null },
          ],
          resposta: '$\\int_0^1 x\\,e^x\\,dx = 1$.',
          verificacao: 'Derivando $(x - 1)\\,e^x$, volta-se ao integrando: $e^x + (x - 1)\\,e^x = x\\,e^x$.',
        },
        {
          rotulo: 'b',
          enunciado: '$\\int x\\ln x\\,dx$, para $x > 0$',
          estrategia: 'De novo por partes, agora com $u = \\ln x$, que fica mais simples ao derivar, e $dv = x\\,dx$.',
          passos: [
            { texto: 'Então $du = \\frac{1}{x}\\,dx$ e $v = \\frac{x^2}{2}$:', calculo: '$$\\int x\\ln x\\,dx = \\frac{x^2}{2}\\ln x - \\int \\frac{x^2}{2}\\cdot\\frac{1}{x}\\,dx$$' },
            { texto: 'A integral que sobrou é imediata:', calculo: '$$\\int \\frac{x}{2}\\,dx = \\frac{x^2}{4} + C$$' },
            { texto: '$\\int x\\ln x\\,dx = \\frac{x^2}{2}\\ln x - \\frac{x^2}{4} + C$, para $x > 0$.', calculo: null },
          ],
          resposta: '$\\int x\\ln x\\,dx = \\frac{x^2}{2}\\ln x - \\frac{x^2}{4} + C$.',
          verificacao: 'Derivando: $x\\ln x + \\frac{x^2}{2}\\cdot\\frac{1}{x} - \\frac{x}{2} = x\\ln x$.',
        },
      ],
      conceitos: ['Integração por partes', 'Integral definida', 'Teorema fundamental do cálculo'],
      observacao: null,
    },
    execucao: { modelo: 'codex', esforco: 'medium' },
    mensagens: [
      { id: '01K7DEMOPERGUNTA000000001', autor: 'leitor', texto: 'Por que não escolher u = eˣ no item a?', criada_em: '2026-10-13T12:00:00.000Z' },
      {
        id: '01K7DEMORESPOSTA000000001', autor: 'ia', passos: [], execucao: { modelo: 'codex', esforco: 'medium' }, criada_em: '2026-10-13T12:00:20.000Z',
        texto: 'Porque $e^x$ não fica mais simples ao derivar, e $x$ fica. Com $u = e^x$ e $dv = x\\,dx$, sobraria $\\int \\frac{x^2}{2}\\,e^x\\,dx$: uma potência de $x$ maior do que a do começo.',
      },
    ],
    criada_em: '2026-10-13T11:58:00.000Z',
  },
};
