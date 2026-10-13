/**
 * Monta o formulário de uma sala: perguntas com os quatro tipos do contrato, obrigatórias ou não,
 * opções da escolha e rótulos da escala. Ids nascem do enunciado e não se repetem.
 */
import type { ReactNode } from 'react';
import { TIPOS_DE_PERGUNTA_DA_SALA, type PerguntaDaSalaV1, type TipoDePerguntaDaSala } from '@margem/contratos/sala';
import { Icon } from '../ui/Icon';
import { Button, Checkbox, IconButton, Input, Select, Textarea } from '../ui/Primitives';

export const NOMES_DOS_TIPOS: Record<TipoDePerguntaDaSala, string> = {
  escala: 'Escala de 1 a 5', escolha: 'Escolha única', texto_curto: 'Texto curto', texto_longo: 'Texto longo',
};

/** `Qual foi a sua impressão?` → `qual_foi_a_sua_impressao`, sem repetir os já usados. */
export function idDoEnunciado(enunciado: string, usados: ReadonlySet<string>): string {
  const base = enunciado.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 32) || 'pergunta';
  let id = base; let n = 2;
  while (usados.has(id)) id = `${base.slice(0, 36)}_${String(n++)}`;
  return id;
}

function semExtras(pergunta: PerguntaDaSalaV1): PerguntaDaSalaV1 {
  const resto = { ...pergunta };
  delete resto.opcoes; delete resto.rotulos;
  return resto;
}

function comRotulos(pergunta: PerguntaDaSalaV1, minimo: string, maximo: string): PerguntaDaSalaV1 {
  const resto = { ...pergunta };
  delete resto.rotulos;
  return minimo || maximo ? { ...resto, rotulos: { minimo, maximo } } : resto;
}

function comTipo(pergunta: PerguntaDaSalaV1, tipo: TipoDePerguntaDaSala): PerguntaDaSalaV1 {
  const resto = semExtras(pergunta);
  if (tipo === 'escolha') return { ...resto, tipo, opcoes: pergunta.opcoes ?? ['Sim', 'Não'] };
  if (tipo === 'escala') return { ...resto, tipo, ...(pergunta.rotulos ? { rotulos: pergunta.rotulos } : {}) };
  return { ...resto, tipo };
}

export function EditorDoFormulario({ perguntas, aoMudar, rotulo }: { perguntas: readonly PerguntaDaSalaV1[]; aoMudar: (perguntas: PerguntaDaSalaV1[]) => void; rotulo: string }): ReactNode {
  const trocar = (indice: number, nova: PerguntaDaSalaV1) => aoMudar(perguntas.map((p, i) => (i === indice ? nova : p)));
  const mover = (indice: number, passo: -1 | 1) => {
    const lista = [...perguntas]; const alvo = indice + passo;
    if (alvo < 0 || alvo >= lista.length) return;
    [lista[indice], lista[alvo]] = [lista[alvo]!, lista[indice]!];
    aoMudar(lista);
  };
  const adicionar = () => {
    const usados = new Set(perguntas.map((p) => p.id));
    aoMudar([...perguntas, { id: idDoEnunciado(`pergunta ${String(perguntas.length + 1)}`, usados), tipo: 'texto_longo', enunciado: 'Nova pergunta', obrigatoria: false }]);
  };
  return <div className="editor-do-formulario" aria-label={rotulo}>
    <ol className="perguntas-do-editor">
      {perguntas.map((pergunta, indice) => <li key={pergunta.id} className="pergunta-do-editor">
        <div className="pergunta-do-editor-linha">
          <span className="session-dot" aria-hidden="true">{indice + 1}</span>
          <Input aria-label={`Enunciado da pergunta ${String(indice + 1)}`} value={pergunta.enunciado} maxLength={300}
            onChange={(e) => trocar(indice, { ...pergunta, enunciado: e.target.value })} />
          <Select aria-label={`Tipo da pergunta ${String(indice + 1)}`} value={pergunta.tipo} onChange={(e) => trocar(indice, comTipo(pergunta, e.target.value as TipoDePerguntaDaSala))}>
            {TIPOS_DE_PERGUNTA_DA_SALA.map((tipo) => <option key={tipo} value={tipo}>{NOMES_DOS_TIPOS[tipo]}</option>)}
          </Select>
        </div>
        <div className="pergunta-do-editor-detalhes">
          {pergunta.tipo === 'escolha' && <label className="campo">Opções, uma por linha
            <Textarea className="opcoes-da-escolha" rows={3} value={(pergunta.opcoes ?? []).join('\n')}
              onChange={(e) => trocar(indice, { ...pergunta, opcoes: e.target.value.split('\n').map((o) => o.trimStart()).slice(0, 10) })} /></label>}
          {pergunta.tipo === 'escala' && <div className="dupla-compacta">
            <label className="campo">O que é 1<Input value={pergunta.rotulos?.minimo ?? ''} maxLength={60} placeholder="Ruim"
              onChange={(e) => trocar(indice, comRotulos(pergunta, e.target.value, pergunta.rotulos?.maximo ?? ''))} /></label>
            <label className="campo">O que é 5<Input value={pergunta.rotulos?.maximo ?? ''} maxLength={60} placeholder="Ótima"
              onChange={(e) => trocar(indice, comRotulos(pergunta, pergunta.rotulos?.minimo ?? '', e.target.value))} /></label>
          </div>}
          <div className="pergunta-do-editor-acoes">
            <Checkbox checked={pergunta.obrigatoria} onChange={(obrigatoria) => trocar(indice, { ...pergunta, obrigatoria })}>Obrigatória</Checkbox>
            <span className="pergunta-do-editor-mover">
              <IconButton aria-label="Subir pergunta" disabled={indice === 0} onClick={() => mover(indice, -1)}><Icon name="anterior" size={16} /></IconButton>
              <IconButton aria-label="Descer pergunta" disabled={indice === perguntas.length - 1} onClick={() => mover(indice, 1)}><Icon name="proximo" size={16} /></IconButton>
              <IconButton aria-label="Remover pergunta" onClick={() => aoMudar(perguntas.filter((_, i) => i !== indice))}><Icon name="xis" size={16} /></IconButton>
            </span>
          </div>
        </div>
      </li>)}
    </ol>
    <Button onClick={adicionar}><Icon name="adicionar" size={16} />Adicionar pergunta</Button>
  </div>;
}

/** Limpa o que o editor deixa solto (opções vazias, rótulos pela metade) antes de mandar ao serviço. */
export function perguntasProntas(perguntas: readonly PerguntaDaSalaV1[]): PerguntaDaSalaV1[] {
  return perguntas.map((pergunta) => {
    const limpa: PerguntaDaSalaV1 = { ...pergunta, enunciado: pergunta.enunciado.trim() };
    if (limpa.opcoes) limpa.opcoes = [...new Set(limpa.opcoes.map((o) => o.trim()).filter((o) => o !== ''))];
    if (limpa.rotulos && (limpa.rotulos.minimo.trim() === '' || limpa.rotulos.maximo.trim() === '')) delete limpa.rotulos;
    if (limpa.ajuda !== undefined && limpa.ajuda.trim() === '') delete limpa.ajuda;
    return limpa;
  });
}
