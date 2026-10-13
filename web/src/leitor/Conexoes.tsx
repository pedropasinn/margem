import { Button, Select, Textarea, Input } from '../ui/Primitives';
import { campoTexto } from './formulario';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
    <div className="button-row"><Button type="submit" disabled={ocupado}>{tipo === 'trecho' ? 'Escolher trecho de destino' : 'Criar conexão'}</Button><Button type="button" onClick={aoFechar}>Cancelar</Button></div>
  </form>;
}
export function ListaDeConexoes({ conexoes, aoMudar, aoCitar }: { conexoes: readonly ConexaoV2[]; aoMudar: () => void; aoCitar: (a: AncoraV1) => void }): ReactNode {
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupada, ocupar] = useState<string | null>(null);
  async function decidir(id: string, estado: 'aceita' | 'rejeitada') {
    if (ocupada) return;
    ocupar(id); definirErro(null);
    try { await escrever(`/api/conexoes/${id}/decidir`, { estado }); aoMudar(); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível registrar a decisão.'); }
    finally { ocupar(null); }
  }
  return <div className="conexoes-do-trecho">{conexoes.filter((c) => c.estado !== 'rejeitada').map((c) => <div key={c.id}>
    <p>↗ {RELACOES[c.relacao]} · {c.estado === 'sugerida' ? 'sugerida pela IA' : 'aceita'}</p>
    {c.destino.tipo === 'trecho' ? <Button type="button" className="citacao-link" onClick={() => aoCitar(c.destino.tipo === 'trecho' ? c.destino.ancora : c.origem)}>{c.destino.ancora.citacao}</Button> : c.destino.tipo === 'documento' ? <a href={`/documentos/${c.destino.documento_id}`}>Documento da biblioteca</a> : <p>{c.destino.titulo} · {c.destino.caminho}</p>}
    <p>{c.justificativa}</p>
    {c.estado === 'sugerida' && <div className="button-row"><Button type="button" disabled={ocupada !== null} onClick={() => void decidir(c.id, 'aceita')}>Aceitar</Button><Button type="button" disabled={ocupada !== null} onClick={() => void decidir(c.id, 'rejeitada')}>Rejeitar</Button></div>}
  </div>)}{erro && <p role="alert">{erro}</p>}</div>;
}
