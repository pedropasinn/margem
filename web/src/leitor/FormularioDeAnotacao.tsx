import { Button, Select, Textarea, Input } from '../ui/Primitives';
import { campoTexto } from './formulario';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AncoraV1, AnotacaoV1, TipoAnotacao } from '@margem/contratos';
import { ErroDaApi, escrever } from '../biblioteca/api';
export const TIPOS_DE_ANOTACAO: Record<TipoAnotacao, string> = { impressao: 'Impressão', observacao: 'Observação', hipotese: 'Hipótese', duvida: 'Dúvida', fonte: 'Fonte', nota: 'Nota' };
export function FormularioDeAnotacao({ ancora, anotacao: inicial, marcaId, aoSalvar, aoFechar, aoConflito }: {
  ancora: AncoraV1; anotacao?: AnotacaoV1 | undefined; aoSalvar: (anotacao: AnotacaoV1) => void; aoFechar: () => void;
  /** A marca que esta anotação comenta (nota sobre um grifo, pelo balão da marca). */
  marcaId?: string | undefined;
  aoConflito?: () => void;
}): ReactNode {
  const [anotacao, definirAnotacao] = useState(inicial);
  const [chaveCliente] = useState(() => crypto.randomUUID());
  const enviando = useRef(false);
  const [tipo, definirTipo] = useState<TipoAnotacao>(anotacao?.tipo ?? 'impressao');
  const [erro, definirErro] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando.current) return;
    const dados = new FormData(e.currentTarget);
    const texto = campoTexto(dados, 'texto').trim();
    if (!texto) { definirErro('Escreva sua anotação.'); return; }
    enviando.current = true; ocupar(true); definirErro(null);
    const fonte = tipo === 'fonte' ? { titulo: campoTexto(dados, 'titulo'), ...(dados.get('pagina') ? { pagina: campoTexto(dados, 'pagina') } : {}), ...(dados.get('url') ? { url: campoTexto(dados, 'url') } : {}) } : undefined;
    try {
      const resposta = await escrever<{ anotacao: AnotacaoV1 }>(`/api/anotacoes${anotacao ? `/${anotacao.id}` : ''}`,
        { ...(anotacao ? { revisao: anotacao.revisao_edicao } : { chave_cliente: chaveCliente, ancora, ...(marcaId ? { marca_id: marcaId } : {}) }), tipo, texto, ...(fonte ? { fonte } : anotacao?.tipo === 'fonte' ? { fonte: null } : {}) }, anotacao ? 'PATCH' : 'POST');
      aoSalvar(resposta.anotacao);
    } catch (falha) {
      if (falha instanceof ErroDaApi && falha.status === 409 && falha.codigo === 'anotacao_obsoleta') {
        const atual = (falha.corpo as { anotacao?: AnotacaoV1 } | undefined)?.anotacao;
        if (atual && atual.id === anotacao?.id) { definirAnotacao(atual); definirTipo(atual.tipo); }
        definirErro('Esta anotação mudou em outro lugar. Carregamos a versão atual; confira antes de editar novamente.');
        aoConflito?.();
      } else definirErro(falha instanceof Error ? falha.message : 'Não foi possível salvar.');
    }
    finally { enviando.current = false; ocupar(false); }
  }
  return <form key={anotacao?.revisao_edicao ?? 0} className="formulario formulario-estudo" aria-label={anotacao ? 'Editar anotação' : 'Anotar trecho'} onSubmit={(e) => void salvar(e)}>
    <label>Tipo<Select aria-label="Tipo de anotação" value={tipo} onChange={(e) => definirTipo(e.target.value as TipoAnotacao)}>{Object.entries(TIPOS_DE_ANOTACAO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</Select></label>
    <label>Sua anotação<Textarea name="texto" autoFocus required maxLength={8000} defaultValue={anotacao?.texto ?? ''} /></label>
    {tipo === 'fonte' && <><label>Título da fonte<Input name="titulo" required maxLength={500} defaultValue={anotacao?.fonte?.titulo ?? ''} /></label><label>Página<Input name="pagina" maxLength={100} defaultValue={anotacao?.fonte?.pagina ?? ''} /></label><label>URL<Input name="url" type="url" pattern="https?://.*" defaultValue={anotacao?.fonte?.url ?? ''} /></label></>}
    {erro && <p role="alert">{erro}</p>}
    <div className="button-row"><Button type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar anotação'}</Button><Button type="button" onClick={aoFechar}>Cancelar</Button></div>
  </form>;
}
