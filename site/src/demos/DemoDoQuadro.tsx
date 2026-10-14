import type { ReactNode } from 'react';
import '../estilos/app-embutido.css';
import type { AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import { QuadroAberto } from '@app/quadros/QuadroAberto';
import type { AnaliseDoQuadro, DetalheDoQuadro } from '@app/quadros/tipos';
import modelo from '../../../fixtures/arte/educacao.modelo.json';
import curta from '../../../fixtures/arte/educacao.curta.json';

/*
 * O leitor de quadro do app (`web/src/quadros/QuadroAberto.tsx`, com o palco, as regiões, o painel
 * Info/Análise/Fontes, a análise curta e o Percorrer), aberto na obra de exemplo que vem com o app:
 * "Educação obrigatória", de Briton Rivière (1887, domínio público). O modelo e a análise curta são
 * os do repositório (`fixtures/arte/educacao.*.json`), os mesmos que o serviço entrega em
 * `GET /api/arte/educacao`; a imagem é a de `web/public/arte/educacao.jpg`, reduzida para a página.
 */
const ANALISE: AnaliseDoQuadro = {
  rotulo: 'esperado', titulo: 'Referência', origem: 'esperado', audio: false, imagem: '/demo/educacao.jpg',
  modelo: modelo as unknown as ModeloDaObraV1, curta: curta as unknown as AnaliseCurtaDaObraV1,
};

const DETALHE: DetalheDoQuadro = {
  slug: 'educacao', origem: 'fixture', adicionado_em: '2026-09-30T12:00:00.000Z',
  imagem: { url: '/demo/educacao.jpg', miniatura: '/demo/educacao.jpg', info: null },
  analises: [{ rotulo: 'esperado', titulo: 'Referência', origem: 'esperado', publicada: true, audio: false, atualizada_em: '2026-09-30T12:00:00.000Z' }],
  analise: ANALISE,
};

const nada = (): void => undefined;

export default function DemoDoQuadro(): ReactNode {
  return (
    <div className="app-embutido demo-app demo-do-quadro">
      <QuadroAberto detalhe={DETALHE} analise={ANALISE} manifesto={null} audio={null} carregandoAnalise={false}
        aoEscolherAnalise={nada} hrefDeVolta="#estudar" aoVoltar={nada} atalhosSoComFoco />
    </div>
  );
}
