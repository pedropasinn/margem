import { Button, Select, Input, Checkbox } from '../Primitives';
import { useState, type ReactNode } from 'react';
import { ReaderController } from '../../leitor/ReaderController';
import { capituloExemplo } from '../../leitor/fixtures/capitulo-exemplo';
import { Destaque } from './Destaque';
import type { Acao, OpcoesDoTraco } from './tracos';
import './galeria.css';

const ACOES: { acao: Acao; nome: string; texto: string }[] = [
  { acao: 'marca_texto', nome: 'Marca-texto', texto: 'O que merece uma segunda leitura.' },
  { acao: 'sublinhado', nome: 'Sublinhado', texto: 'Sob essas condições, a afirmação vale.' },
  { acao: 'caixa', nome: 'Caixa', texto: 'Uma ideia para guardar.' },
  { acao: 'circulo', nome: 'Círculo', texto: 'O centro do argumento.' },
  { acao: 'colchete', nome: 'Colchete', texto: 'Cada passo sustenta o seguinte.' },
  { acao: 'riscado', nome: 'Riscado', texto: 'Uma hipótese que não se sustenta.' },
  { acao: 'xis', nome: 'Xis', texto: 'Uma possibilidade descartada.' },
];
export function Galeria(): ReactNode {
  const [opcoes, definir] = useState<OpcoesDoTraco>({ cor: '#ffd926', espessura: 2, iteracoes: 1, rugosidade: .55, recuo: 2, inclinacao: .015, semente: 42, lado: 'esquerda' });
  const [duracao, definirDuracao] = useState(500);
  const [multilinha, definirMultilinha] = useState(false);
  const [rodada, repetir] = useState(0);
  const mudar = (valores: OpcoesDoTraco) => definir((atuais) => ({ ...atuais, ...valores }));
  return <main className="galeria">
    <header className="galeria-topo"><div><a href="/" className="voltar">← Margem</a><span className="eyebrow">Caderno de traços</span><h1>Uma marca, <Destaque cor="#59d675">a sua mão.</Destaque></h1><p>Ajuste o gesto. Veja o que muda no texto.</p></div><span className="badge">Componentes</span></header>
    <div className="galeria-grade">
      <section className="card formulario controles-tracos" aria-label="Controles dos traços">
        <h2>O traço</h2>
        <div className="dupla"><label>Cor<Input type="color" value={opcoes.cor} onChange={(e) => mudar({ cor: e.target.value })} /></label>
          <label>Semente<Input type="number" value={opcoes.semente} onChange={(e) => mudar({ semente: Number(e.target.value) })} /></label></div>
        {([
          ['espessura', 'Espessura', .5, 8, .5], ['iteracoes', 'Iterações', 1, 3, 1],
          ['rugosidade', 'Rugosidade', 0, 1, .05], ['recuo', 'Recuo', 0, 12, 1], ['inclinacao', 'Inclinação', 0, .05, .005],
        ] as const).map(([chave, rotulo, min, max, passo]) => <label key={chave}>{rotulo} · {opcoes[chave]}<Input type="range" min={min} max={max} step={passo} value={opcoes[chave]} onChange={(e) => mudar({ [chave]: Number(e.target.value) })} /></label>)}
        <label>Duração · {duracao} ms<Input type="range" min="0" max="2000" step="100" value={duracao} onChange={(e) => definirDuracao(Number(e.target.value))} /></label>
        <label>Lado do colchete<Select aria-label="Lado do colchete" value={opcoes.lado} onChange={(e) => mudar({ lado: e.target.value as 'esquerda' | 'direita' })}><option value="esquerda">Esquerda</option><option value="direita">Direita</option></Select></label>
        <Checkbox checked={multilinha} onChange={definirMultilinha}>Texto em várias linhas</Checkbox>
        <Button className="button small" type="button" onClick={() => repetir(rodada + 1)}>Redesenhar</Button>
      </section>
      <section className="amostras-tracos" aria-label="Ações do marcador">{ACOES.map(({ acao, nome, texto }) => <article className="amostra-traco" key={acao}>
        <span className="eyebrow">{nome}</span><p><Destaque key={rodada} {...opcoes} acao={acao} duracao={duracao}>{multilinha ? `${texto} Ler com atenção é reconhecer o argumento, preservar suas condições e voltar ao trecho quando uma pergunta pedir mais tempo. A margem guarda essa conversa.` : texto}</Destaque></p>
      </article>)}</section>
    </div>
    <section className="galeria-leitor" aria-label="Capítulo de exemplo"><div className="galeria-subtitulo"><span className="eyebrow">No livro</span><h2>O texto continua no centro.</h2></div>
      <ReaderController snapshot={capituloExemplo} documento_id={'0'.repeat(22) + 'D011'} aparenciaAberta />
    </section>
  </main>;
}
