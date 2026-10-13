/**
 * As notas de um grifo (J37): a nota do Codex (o comentário da marca) e as do leitor ligadas a ela,
 * quantas forem. Cada um mexe na do outro: o leitor reescreve a nota do Codex (a original fica guardada,
 * com volta) e pede ao Codex que revise uma nota sua (o texto anterior e o motivo ficam com a nota).
 * Tudo em texto puro: nada do modelo vai para `innerHTML`.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AnotacaoV1, Id, MarcaV2 } from '@margem/contratos';
import { ErroDaApi, apagarAnotacao, editarAnotacao, editarNotaDaMarca, pedirRevisaoDaNota } from '../biblioteca/api';
import { Button, Textarea } from '../ui/Primitives';
import { FormularioDeAnotacao, TIPOS_DE_ANOTACAO } from './FormularioDeAnotacao';
import { usarDesfazer } from './desfazer';
import type { MarcaDoLeitor } from './f2';

export interface FontesDasNotas {
  editarNotaDaMarca: (id: Id, texto: string | null) => Promise<unknown>;
  editarAnotacao: (id: Id, mudanca: { texto: string; revisao: number }) => Promise<unknown>;
  apagarAnotacao: (id: Id, revisao: number) => Promise<unknown>;
  pedirRevisao: (id: Id, instrucao?: string) => Promise<unknown>;
}
export const FONTES_DAS_NOTAS: FontesDasNotas = { editarNotaDaMarca, editarAnotacao, apagarAnotacao, pedirRevisao: pedirRevisaoDaNota };

export function NotasDoGrifo({ marca, anotacoes, pendentes, comentarioDaIa, aoMudar, fontes = FONTES_DAS_NOTAS }: {
  marca: MarcaDoLeitor;
  /** As anotações do leitor sobre esta marca (`marca_id`). */
  anotacoes: readonly AnotacaoV1[];
  /** Notas que o Codex está revisando agora. */
  pendentes: readonly Id[];
  /** A nota que a IA escreveu, quando o leitor já a reescreveu. */
  comentarioDaIa?: MarcaV2['comentario'] | undefined;
  aoMudar: () => void;
  fontes?: FontesDasNotas;
}): ReactNode {
  const pilha = usarDesfazer();
  const [nova, abrirNova] = useState(anotacoes.length === 0 && (marca.comentario === null || marca.origem === 'manual'));
  const [erro, definirErro] = useState<string | null>(null);
  const agir = (acao: () => Promise<unknown>, padrao: string) => acao().then(() => { definirErro(null); aoMudar(); }, (falha: unknown) => {
    if (falha instanceof ErroDaApi && falha.status === 409 && falha.codigo === 'anotacao_obsoleta') {
      definirErro('Esta anotação mudou em outro lugar. Carregamos a versão atual; confira antes de tentar novamente.');
      aoMudar();
    } else definirErro(falha instanceof Error ? falha.message : padrao);
    throw falha;
  });
  return <section className="notas-do-grifo" aria-label="Notas do grifo">
    {marca.comentario !== null && <NotaDoCodex marca={marca} original={comentarioDaIa ?? undefined}
      aoEditar={(texto) => {
        const antes = marca.comentario?.texto ?? null;
        return agir(() => fontes.editarNotaDaMarca(marca.id, texto), 'Não foi possível salvar a nota.').then(() => {
          if (antes !== null) pilha.registrar({ rotulo: texto === null ? 'Nota do Codex restaurada' : 'Nota do Codex editada',
            // Se o texto de antes era o da IA, desfazer é voltar ao original (e ela deixa de contar como editada).
            desfazer: () => agir(() => fontes.editarNotaDaMarca(marca.id, !comentarioDaIa || comentarioDaIa.texto === antes ? null : antes), 'Não foi possível desfazer.').then(() => undefined) });
        });
      }} />}
    {anotacoes.map((anotacao) => <NotaDoLeitor key={anotacao.id} anotacao={anotacao} pendente={pendentes.includes(anotacao.id)} aoMudar={aoMudar}
      aoApagar={() => { void agir(() => fontes.apagarAnotacao(anotacao.id, anotacao.revisao_edicao), 'Não foi possível apagar a nota.').catch(() => undefined); }}
      aoVoltar={(texto) => { void agir(() => fontes.editarAnotacao(anotacao.id, { texto, revisao: anotacao.revisao_edicao }), 'Não foi possível voltar ao seu texto.').catch(() => undefined); }}
      aoPedirRevisao={(instrucao) => agir(() => fontes.pedirRevisao(anotacao.id, instrucao), 'Não foi possível pedir a revisão.')} />)}
    {erro && <p className="aviso-estudo" role="alert">{erro}</p>}
    {nova
      ? <div className="nota-nova"><span className="eyebrow">Nova nota sua</span>
        <FormularioDeAnotacao ancora={marca.ancora} marcaId={marca.id} aoFechar={() => abrirNova(false)} aoSalvar={() => { abrirNova(false); aoMudar(); }} /></div>
      : <Button type="button" onClick={() => abrirNova(true)}>+ Nota sua</Button>}
  </section>;
}

function NotaDoCodex({ marca, original, aoEditar }: {
  marca: MarcaDoLeitor; original: MarcaV2['comentario'] | undefined; aoEditar: (texto: string | null) => Promise<void>;
}): ReactNode {
  const [editando, editar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const comentario = marca.comentario;
  if (comentario === null) return null;
  const salvar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const campo = new FormData(evento.currentTarget).get('texto');
    const texto = typeof campo === 'string' ? campo.trim() : '';
    if (texto === '' || texto === comentario.texto) { editar(false); return; }
    ocupar(true);
    void aoEditar(texto).then(() => editar(false), () => undefined).finally(() => ocupar(false));
  };
  const editada = original !== undefined && original !== null && original.texto !== comentario.texto;
  return <article className="nota-do-grifo" data-autor="codex">
    <p className="eyebrow">Codex · {comentario.rotulo}{editada && <span className="nota-editada"> · editada por você</span>}</p>
    {editando
      ? <form className="formulario formulario-estudo" aria-label="Editar a nota do Codex" onSubmit={salvar}>
        <label>Nota do Codex<Textarea name="texto" autoFocus required maxLength={2000} defaultValue={comentario.texto} /></label>
        <div className="button-row"><Button type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</Button><Button type="button" onClick={() => editar(false)}>Cancelar</Button></div>
      </form>
      : <p className="texto-pessoal">{comentario.texto}</p>}
    {editada && !editando && <details className="nota-anterior"><summary>O que o Codex escreveu</summary><p>{original.texto}</p></details>}
    {!editando && <div className="acoes-pessoais">
      <Button type="button" onClick={() => editar(true)}>Editar</Button>
      {editada && <Button type="button" disabled={ocupado} onClick={() => { ocupar(true); void aoEditar(null).catch(() => undefined).finally(() => ocupar(false)); }}>Voltar ao original</Button>}
    </div>}
  </article>;
}

function NotaDoLeitor({ anotacao, pendente, aoMudar, aoApagar, aoVoltar, aoPedirRevisao }: {
  anotacao: AnotacaoV1; pendente: boolean; aoMudar: () => void; aoApagar: () => void; aoVoltar: (texto: string) => void;
  aoPedirRevisao: (instrucao?: string) => Promise<void>;
}): ReactNode {
  const [modo, definirModo] = useState<'ler' | 'editar' | 'pedir'>('ler');
  const [instrucao, definirInstrucao] = useState('');
  const [ocupado, ocupar] = useState(false);
  const revisao = anotacao.revisao;
  const pedir = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    ocupar(true);
    const texto = instrucao.trim();
    void aoPedirRevisao(texto === '' ? undefined : texto).then(() => { definirModo('ler'); definirInstrucao(''); }, () => undefined).finally(() => ocupar(false));
  };
  return <article className="nota-do-grifo" data-autor="leitor" aria-busy={pendente}>
    <p className="eyebrow">Você · {TIPOS_DE_ANOTACAO[anotacao.tipo]}{revisao && <span className="nota-editada"> · revista pelo Codex</span>}</p>
    {modo === 'editar'
      ? <FormularioDeAnotacao ancora={anotacao.ancora} anotacao={anotacao} aoConflito={aoMudar} aoFechar={() => definirModo('ler')} aoSalvar={() => { definirModo('ler'); aoMudar(); }} />
      : <p className="texto-pessoal">{anotacao.texto}</p>}
    {revisao && modo === 'ler' && <details className="nota-anterior">
      <summary>Por que o Codex mudou</summary>
      <p>{revisao.motivo}</p>
      <p className="nota-anterior-texto"><span>Seu texto antes:</span> {revisao.texto_anterior}</p>
      {revisao.texto_anterior !== anotacao.texto && <Button type="button" onClick={() => aoVoltar(revisao.texto_anterior)}>Voltar ao meu texto</Button>}
    </details>}
    {pendente && <p className="nota-pendente" role="status">O Codex está revisando esta nota…</p>}
    {modo === 'pedir' && <form className="formulario formulario-estudo" aria-label="Pedir revisão ao Codex" onSubmit={pedir}>
      <label>O que pedir ao Codex (opcional)<Textarea autoFocus maxLength={1000} value={instrucao} placeholder="Ex.: deixe mais claro; formule como pergunta; corrija o termo."
        onChange={(evento) => definirInstrucao(evento.target.value)} /></label>
      <div className="button-row"><Button type="submit" disabled={ocupado}>{ocupado ? 'Pedindo…' : 'Pedir revisão'}</Button><Button type="button" onClick={() => definirModo('ler')}>Cancelar</Button></div>
    </form>}
    {modo === 'ler' && <div className="acoes-pessoais">
      <Button type="button" onClick={() => definirModo('editar')}>Editar</Button>
      <Button type="button" disabled={pendente} onClick={() => definirModo('pedir')}>Pedir ao Codex</Button>
      <Button type="button" onClick={aoApagar}>Apagar</Button>
    </div>}
  </article>;
}
