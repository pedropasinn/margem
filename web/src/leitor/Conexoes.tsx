import { Button, Select, Textarea, Input, usarFoco } from '../ui/Primitives';
import { campoTexto } from './formulario';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AncoraV1, ConexaoV2, DestinoConexao, RelacaoConexao } from '@margem/contratos';
import { escrever, listarDocumentos } from '../biblioteca/api';
import type { ItemDaBiblioteca } from '../biblioteca/tipos';
import { usarEscolhaDeDestino } from './ContextoDeConexao';
export const RELACOES: Record<RelacaoConexao, string> = { semelhanca: 'Semelhança', contraste: 'Contraste', tensao: 'Tensão', prerequisito: 'Pré-requisito', desenvolve: 'Desenvolve', exemplo: 'Exemplo' };
export function FormularioDeConexao({ origem, aoSalvar, aoFechar }: { origem: AncoraV1; aoSalvar: (c: ConexaoV2) => void; aoFechar: () => void }): ReactNode {
  const [tipo, definirTipo] = useState<DestinoConexao['tipo']>('trecho');
  const [documentos, definirDocumentos] = useState<ItemDaBiblioteca[]>([]);
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  const { escolher } = usarEscolhaDeDestino();
  useEffect(() => {
    if (tipo !== 'documento') return;
    let vivo = true;
    listarDocumentos().then((r) => { if (vivo) definirDocumentos(r.documentos); }, () => { if (vivo) definirErro('Não foi possível abrir a biblioteca.'); });
    return () => { vivo = false; };
  }, [tipo]);
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (ocupado) return;
    const dados = new FormData(e.currentTarget);
    const relacao = campoTexto(dados, 'relacao') as RelacaoConexao;
    const justificativa = campoTexto(dados, 'justificativa').trim();
    if (!justificativa) return;
    if (tipo === 'trecho') { escolher({ origem, relacao, justificativa }); aoFechar(); return; }
    if (tipo === 'documento' && !campoTexto(dados, 'documento')) { definirErro('Escolha um documento de destino.'); return; }
    const destino: DestinoConexao = tipo === 'documento' ? { tipo, documento_id: campoTexto(dados, 'documento') } : { tipo, caminho: campoTexto(dados, 'caminho'), titulo: campoTexto(dados, 'titulo') };
    ocupar(true); definirErro(null);
    try { aoSalvar((await escrever<{ conexao: ConexaoV2 }>('/api/conexoes', { origem, destino, relacao, justificativa })).conexao); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível conectar.'); }
    finally { ocupar(false); }
  }
  return <form className="formulario formulario-estudo" aria-label="Conectar trecho" onSubmit={(e) => void enviar(e)}>
    <label>Destino<Select aria-label="Tipo de destino" value={tipo} onChange={(e) => definirTipo(e.target.value as DestinoConexao['tipo'])}><option value="trecho">Outro trecho</option><option value="documento">Documento da biblioteca</option><option value="nota_externa">Nota externa</option></Select></label>
    {tipo === 'documento' && <label>Documento<Select name="documento" required aria-label="Documento de destino"><option value="">Escolha um documento</option>{documentos.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}</Select></label>}
    {tipo === 'nota_externa' && <><label>Caminho da nota<Input name="caminho" required placeholder="poemas/releitura.md" /></label><label>Título da nota<Input name="titulo" required /></label></>}
    <label>Relação<Select aria-label="Relação" name="relacao">{Object.entries(RELACOES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</Select></label>
    <label>O que conecta os dois?<Textarea name="justificativa" required maxLength={8000} /></label>
    {erro && <p role="alert">{erro}</p>}
    <div className="ui-rodape"><Button variante="ghost" tamanho="md" onClick={aoFechar}>Cancelar</Button><Button type="submit" variante="primario" tamanho="md" disabled={ocupado}>{tipo === 'trecho' ? 'Escolher trecho de destino' : 'Criar conexão'}</Button></div>
  </form>;
}
export function ListaDeConexoes({ conexoes, aoMudar, aoCitar, doTrecho }: { conexoes: readonly ConexaoV2[]; aoMudar: () => void; aoCitar: (a: AncoraV1) => void; doTrecho?: AncoraV1 }): ReactNode {
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupada, ocupar] = useState<string | null>(null);
  async function decidir(id: string, estado: 'aceita' | 'rejeitada') {
    if (ocupada) return;
    ocupar(id); definirErro(null);
    try { await escrever(`/api/conexoes/${id}/decidir`, { estado }); aoMudar(); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível registrar a decisão.'); }
    finally { ocupar(null); }
  }
  const visiveis = conexoes.filter((c) => c.estado !== 'rejeitada');
  // Lista compacta (J132): o tipo, a citação do outro lado em até duas linhas (clicar leva ao trecho) e a nota curta.
  // "Minhas conexões" (as do leitor, inclusive as adotadas) × "Relações da leitura" (as do Codex, nos braquetes).
  return <>{visiveis.length > 0 && <span className="eyebrow">Minhas conexões</span>}<ul className="conexoes-do-trecho">{visiveis.map((c) => <li key={c.id}>
    <p className="conexao-tipo">{RELACOES[c.relacao]}{c.estado === 'sugerida' ? ' · sugerida pela IA' : ''}</p>
    {c.destino.tipo === 'trecho' ? (() => {
      // Do lado do trecho aberto, a citação é a do outro lado.
      const outro = doTrecho && c.destino.ancora.bloco_id === doTrecho.bloco_id && c.origem.bloco_id !== doTrecho.bloco_id ? c.origem : c.destino.ancora;
      return <button type="button" className="conexao-citacao" onClick={() => aoCitar(outro)}>“{outro.citacao}”</button>;
    })()
      : c.destino.tipo === 'documento' ? <a className="conexao-citacao" href={`/documentos/${c.destino.documento_id}`}>Documento da biblioteca</a> : <p className="conexao-citacao">{c.destino.titulo} · {c.destino.caminho}</p>}
    {c.justificativa.trim() !== RELACOES[c.relacao] && <p className="conexao-nota">{c.justificativa}</p>}
    {c.estado === 'sugerida' && <div className="acoes-pessoais"><Button tamanho="sm" disabled={ocupada !== null} onClick={() => void decidir(c.id, 'aceita')}>Aceitar</Button><Button variante="ghost" tamanho="sm" disabled={ocupada !== null} onClick={() => void decidir(c.id, 'rejeitada')}>Rejeitar</Button></div>}
  </li>)}{erro && <li><p role="alert">{erro}</p></li>}</ul></>;
}

/**
 * O diálogo pequeno do fim da conexão (J132): os dois trechos já escolhidos no texto (nenhum precisa estar
 * grifado), o tipo da relação e uma nota opcional. Sem nota, a justificativa gravada é o nome da relação.
 */
export function DialogoDeConexao({ origem, destino, aoFechar, aoSalvar }: { origem: AncoraV1; destino: AncoraV1; aoFechar: () => void; aoSalvar: (c: ConexaoV2) => void }): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  usarFoco(raiz, aoFechar);
  const [relacao, definirRelacao] = useState<RelacaoConexao>('desenvolve');
  const [nota, definirNota] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    ocupar(true); definirErro(null);
    try { aoSalvar((await escrever<{ conexao: ConexaoV2 }>('/api/conexoes', { origem, destino: { tipo: 'trecho', ancora: destino }, relacao, justificativa: nota.trim() || RELACOES[relacao] })).conexao); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível conectar.'); }
    finally { ocupar(false); }
  }
  return <div className="ui-veu veu-leve"><div ref={raiz} role="dialog" aria-modal="true" aria-label="Conectar estes dois trechos" tabIndex={-1} className="dialogo-de-conexao">
    <form className="formulario formulario-estudo" onSubmit={(e) => void enviar(e)}>
      <h2>Conectar estes dois trechos</h2>
      <ol className="trechos-da-conexao"><li><span>De</span>“{origem.citacao}”</li><li><span>Para</span>“{destino.citacao}”</li></ol>
      <label>Relação<Select aria-label="Relação" value={relacao} onChange={(e) => definirRelacao(e.target.value as RelacaoConexao)}>{Object.entries(RELACOES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</Select></label>
      <label><span>Nota <span className="opcional">(opcional)</span></span><Textarea value={nota} maxLength={2000} onChange={(e) => definirNota(e.target.value)} placeholder="O que liga os dois?" /></label>
      {erro && <p role="alert">{erro}</p>}
      <div className="ui-rodape"><Button variante="ghost" tamanho="md" onClick={aoFechar}>Cancelar</Button><Button type="submit" variante="primario" tamanho="md" disabled={ocupado}>{ocupado ? 'Conectando…' : 'Conectar'}</Button></div>
    </form>
  </div></div>;
}
