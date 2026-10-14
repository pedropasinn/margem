/**
 * A aba Nota do painel do trecho (J138, modelo D): a nota do leitor é do grifo, uma só, texto simples e sem
 * tipo, que se salva sozinha (o mesmo campo do balão). Abaixo, o comentário do Codex, na voz do Assistente,
 * que o leitor pode reescrever (o original fica guardado, com volta). O leitor pode pedir ao Codex que revise
 * a nota dele (o texto anterior e o motivo ficam com a nota). Tudo em texto puro: nada do modelo vai para
 * `innerHTML`.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AnotacaoV1, Id, MarcaV2 } from '@margem/contratos';
import { editarAnotacao, editarNotaDaMarca, pedirRevisaoDaNota } from '../biblioteca/api';
import { Button, Textarea } from '../ui/Primitives';
import { CampoDaNota, FONTES_DO_BALAO, usarNotaDoGrifo, type FontesDoBalao } from './BalaoDaMarca';
import { usarDesfazer } from './desfazer';
import type { MarcaDoLeitor } from './f2';

export interface FontesDasNotas extends Pick<FontesDoBalao, 'gravarNota' | 'apagarNota'> {
  editarNotaDaMarca: (id: Id, texto: string | null) => Promise<unknown>;
  editarAnotacao: (id: Id, mudanca: { texto: string; revisao: number }) => Promise<unknown>;
  pedirRevisao: (id: Id, instrucao?: string) => Promise<unknown>;
}
export const FONTES_DAS_NOTAS: FontesDasNotas = {
  gravarNota: FONTES_DO_BALAO.gravarNota, apagarNota: FONTES_DO_BALAO.apagarNota, editarNotaDaMarca, editarAnotacao, pedirRevisao: pedirRevisaoDaNota,
};

export function NotasDoGrifo({ marca, nota, pendente, comentarioDaIa, aoMudar, fontes = FONTES_DAS_NOTAS }: {
  marca: MarcaDoLeitor;
  /** A nota do leitor sobre este grifo (a anotação ligada a ele), se houver. */
  nota: AnotacaoV1 | null;
  /** O Codex está revisando a nota agora. */
  pendente: boolean;
  /** A nota que a IA escreveu, quando o leitor já a reescreveu. */
  comentarioDaIa?: MarcaV2['comentario'] | undefined;
  aoMudar: () => void;
  fontes?: FontesDasNotas;
}): ReactNode {
  const pilha = usarDesfazer();
  const estado = usarNotaDoGrifo(marca.id, nota, fontes, aoMudar);
  const [erro, definirErro] = useState<string | null>(null);
  const agir = (acao: () => Promise<unknown>, padrao: string) => acao().then(() => { definirErro(null); aoMudar(); }, (falha: unknown) => {
    definirErro(falha instanceof Error ? falha.message : padrao);
    throw falha;
  });
  const comentario = marca.origem !== 'manual' ? marca.comentario : null;
  return <section className="notas-do-grifo" aria-label="Nota do grifo">
    <CampoDaNota estado={estado} />
    {nota && <RevisaoPeloCodex nota={nota} pendente={pendente}
      aoVoltar={(texto) => { void agir(() => fontes.editarAnotacao(nota.id, { texto, revisao: nota.revisao_edicao }), 'Não foi possível voltar ao seu texto.').catch(() => undefined); }}
      aoPedir={(instrucao) => agir(() => fontes.pedirRevisao(nota.id, instrucao), 'Não foi possível pedir a revisão.')} />}
    {comentario && <NotaDoCodex comentario={comentario} original={comentarioDaIa ?? undefined}
      aoEditar={(texto) => {
        const antes = comentario.texto;
        return agir(() => fontes.editarNotaDaMarca(marca.id, texto), 'Não foi possível salvar o comentário.').then(() => {
          pilha.registrar({ rotulo: texto === null ? 'Comentário do Codex restaurado' : 'Comentário do Codex editado',
            // Se o texto de antes era o da IA, desfazer é voltar ao original (e ele deixa de contar como editado).
            desfazer: () => agir(() => fontes.editarNotaDaMarca(marca.id, !comentarioDaIa || comentarioDaIa.texto === antes ? null : antes), 'Não foi possível desfazer.').then(() => undefined) });
        });
      }} />}
    {erro && <p className="aviso-estudo" role="alert">{erro}</p>}
  </section>;
}

/** O comentário do Codex, na voz do Assistente: o leitor reescreve (o original fica, com volta). */
function NotaDoCodex({ comentario, original, aoEditar }: {
  comentario: NonNullable<MarcaV2['comentario']>; original: MarcaV2['comentario'] | undefined; aoEditar: (texto: string | null) => Promise<void>;
}): ReactNode {
  const [editando, editar] = useState(false);
  const [ocupado, ocupar] = useState(false);
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
    <p className="balao-voz">Assistente · {comentario.rotulo}{editada && <span className="nota-editada"> · editado por você</span>}</p>
    {editando
      ? <form className="formulario formulario-estudo" aria-label="Editar o comentário do Codex" onSubmit={salvar}>
        <label>Comentário do Codex<Textarea name="texto" autoFocus required maxLength={2000} defaultValue={comentario.texto} /></label>
        <div className="ui-rodape"><Button variante="ghost" tamanho="md" onClick={() => editar(false)}>Cancelar</Button><Button type="submit" variante="primario" tamanho="md" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</Button></div>
      </form>
      : <p className="texto-pessoal">{comentario.texto}</p>}
    {editada && !editando && <details className="nota-anterior"><summary>O que o Codex escreveu</summary><p>{original.texto}</p></details>}
    {!editando && <div className="acoes-pessoais">
      <Button variante="ghost" tamanho="sm" onClick={() => editar(true)}>Editar</Button>
      {editada && <Button variante="ghost" tamanho="sm" disabled={ocupado} onClick={() => { ocupar(true); void aoEditar(null).catch(() => undefined).finally(() => ocupar(false)); }}>Voltar ao original</Button>}
    </div>}
  </article>;
}

/** Pedir ao Codex que revise a nota do leitor; a revisão feita mostra o motivo e o texto de antes. */
function RevisaoPeloCodex({ nota, pendente, aoVoltar, aoPedir }: {
  nota: AnotacaoV1; pendente: boolean; aoVoltar: (texto: string) => void; aoPedir: (instrucao?: string) => Promise<void>;
}): ReactNode {
  const [pedindo, pedir] = useState(false);
  const [instrucao, definirInstrucao] = useState('');
  const [ocupado, ocupar] = useState(false);
  const revisao = nota.revisao;
  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    ocupar(true);
    const texto = instrucao.trim();
    void aoPedir(texto === '' ? undefined : texto).then(() => { pedir(false); definirInstrucao(''); }, () => undefined).finally(() => ocupar(false));
  };
  return <div className="revisao-da-nota">
    {revisao && <details className="nota-anterior">
      <summary>Revista pelo Codex: por quê</summary>
      <p>{revisao.motivo}</p>
      <p className="nota-anterior-texto"><span>Seu texto antes:</span> {revisao.texto_anterior}</p>
      {revisao.texto_anterior !== nota.texto && <Button variante="ghost" tamanho="sm" onClick={() => aoVoltar(revisao.texto_anterior)}>Voltar ao meu texto</Button>}
    </details>}
    {pendente && <p className="nota-pendente" role="status">O Codex está revisando esta nota…</p>}
    {pedindo
      ? <form className="formulario formulario-estudo" aria-label="Pedir revisão ao Codex" onSubmit={enviar}>
        <label>O que pedir ao Codex (opcional)<Textarea autoFocus maxLength={1000} value={instrucao} placeholder="Ex.: deixe mais claro; formule como pergunta; corrija o termo."
          onChange={(evento) => definirInstrucao(evento.target.value)} /></label>
        <div className="ui-rodape"><Button variante="ghost" tamanho="md" onClick={() => pedir(false)}>Cancelar</Button><Button type="submit" variante="primario" tamanho="md" disabled={ocupado}>{ocupado ? 'Pedindo…' : 'Pedir revisão'}</Button></div>
      </form>
      : <div className="acoes-pessoais"><Button variante="ghost" tamanho="sm" disabled={pendente} onClick={() => pedir(true)}>Pedir ao Codex que revise</Button></div>}
  </div>;
}
