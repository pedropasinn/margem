import { familiaDoModo, modoEmAvaliacao, modosParaNovaLeitura } from './modos-de-leitura';
import { Button, Select, Switch } from '../ui/Primitives';
import { useEffect, useState, type ReactNode } from 'react';
import type { ModoDeLeituraV1 } from '@margem/contratos';
import { AvisoDoCodexCurto } from '../primeira-execucao/PrimeiraExecucao';
import { gravarPreferenciasDoDocumento, obterModos, preferenciasDoDocumento, type OpcoesDeLeitura } from './api';
/**
 * `compreender` (J31): em vez de marcar o livro inteiro de uma vez, cria a compreensão capítulo a
 * capítulo; cada capítulo é preparado quando é aberto no leitor, com o seguinte em segundo plano.
 */
export function PrepararLeitura({ preparar, compreender, aoFechar, textoUnico = false }: {
  textoUnico?: boolean;
  preparar: (opcoes: OpcoesDeLeitura) => Promise<void>; compreender?: (modo: { id: string; revisao: number }) => Promise<void>; aoFechar: () => void;
}): ReactNode {
  const [modos, definirModos] = useState<ModoDeLeituraV1[]>([]);
  const [modo, definirModo] = useState('argumentativa@1');
  const [familia, definirFamilia] = useState('todas');
  const atuais = modosParaNovaLeitura(modos);
  const familias = [...new Set(atuais.map(m => familiaDoModo(m.id)))];
  const disponiveis = atuais.filter(m => familia === 'todas' || familiaDoModo(m.id) === familia);
  const escolhido = atuais.find(m => `${m.id}@${m.revisao}` === modo);
  function mudarFamilia(valor: string) {
    definirFamilia(valor);
    const opcoes = atuais.filter(m => valor === 'todas' || familiaDoModo(m.id) === valor);
    if (!opcoes.some(m => `${m.id}@${m.revisao}` === modo) && opcoes[0]) definirModo(`${opcoes[0].id}@${opcoes[0].revisao}`);
  }
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    obterModos().then((r) => { if (vivo) definirModos(r.modos); }, () => { if (vivo) definirErro('Não foi possível carregar os modos. A leitura padrão continua disponível.'); });
    return () => { vivo = false; };
  }, []);
  async function enviarCompreensao() {
    if (ocupado || !compreender) return;
    ocupar(true); definirErro(null);
    try {
      const [id, revisao] = modo.split('@');
      await compreender({ id: id ?? 'argumentativa', revisao: Number(revisao ?? 1) });
      aoFechar();
    } catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível criar a compreensão.'); }
    finally { ocupar(false); }
  }
  async function enviar(padrao: boolean) {
    if (ocupado) return;
    ocupar(true); definirErro(null);
    try {
      const [id, revisao] = modo.split('@');
      // Sempre as três saliências: o nível de atenção do leitor só escolhe o que mostrar.
      await preparar(padrao ? {} : { modo_de_leitura: { id: id ?? 'argumentativa', revisao: Number(revisao ?? 1) }, nivel_de_atencao: 3 });
      aoFechar();
    } catch (falha) { definirErro(`${falha instanceof Error ? falha.message : 'Não foi possível preparar as marcas.'} Você pode tentar a leitura padrão.`); }
    finally { ocupar(false); }
  }
  return <section className="formulario preparar-leitura" aria-label="Preparar leitura">
    <label>Família do texto<Select aria-label="Família do texto" value={familia} onChange={e => mudarFamilia(e.target.value)}><option value="todas">Todas as famílias</option>{familias.map(f => <option key={f} value={f}>{f}</option>)}</Select></label>
    <label>Modo de leitura<Select aria-label="Modo de leitura" value={modo} onChange={(e) => definirModo(e.target.value)}>{disponiveis.length ? disponiveis.map((m) => <option key={`${m.id}@${m.revisao}`} value={`${m.id}@${m.revisao}`}>{m.nome}</option>) : <option value="argumentativa@1">Argumentativa</option>}</Select></label>
    {escolhido && <p>{escolhido.descricao}</p>}
    {escolhido && modoEmAvaliacao(escolhido) && <p>Modo em avaliação. Você pode experimentar e conferir as marcações no próprio texto.</p>}
    {['ficcao_narrativa', 'dramaturgia'].includes(escolhido?.id ?? '') && <p>A compreensão considera o capítulo inteiro e pode antecipar acontecimentos. Para a primeira leitura, você pode ler o texto sem preparar a análise.</p>}
    <AvisoDoCodexCurto />
    {erro && <p role="alert">{erro}</p>}
    <div className="button-row">{compreender && <Button className="button small" disabled={ocupado} type="button" onClick={() => void enviarCompreensao()}>{textoUnico ? 'Compreender o texto' : 'Compreender capítulo a capítulo'}</Button>}<Button className="button small" disabled={ocupado} type="button" onClick={() => void enviar(false)}>Preparar leitura escolhida</Button><Button className="button small" disabled={ocupado} type="button" onClick={() => void enviar(true)}>Usar leitura padrão</Button><Button type="button" onClick={aoFechar}>Cancelar</Button></div>
  </section>;
}
export function PrimeiroEuDoDocumento({ documentoId }: { documentoId: string }): ReactNode {
  const [ativo, definir] = useState(false);
  const [pronto, preparar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    preferenciasDoDocumento(documentoId).then((r) => { if (vivo) { definir(r.preferencias.primeiro_eu); preparar(true); } }, () => { if (vivo) definirErro('Não foi possível carregar a preferência Primeiro eu.'); });
    return () => { vivo = false; };
  }, [documentoId]);
  async function mudar(valor: boolean) {
    ocupar(true); definirErro(null);
    try { await gravarPreferenciasDoDocumento(documentoId, { primeiro_eu: valor }); definir(valor); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível salvar a preferência.'); }
    finally { ocupar(false); }
  }
  return <div><Switch checked={ativo} disabled={!pronto || ocupado} onChange={(valor) => void mudar(valor)}>Primeiro eu</Switch>{erro && <p role="alert">{erro}</p>}</div>;
}
