/**
 * Salas de teste, lado do dono (no app de sempre, pela tailnet): a lista, a sala nova ou em
 * edição (título, boas-vindas, documentos, senha, validade, formulário) e o convite pronto para
 * mandar. As respostas ficam em `RespostasDaSala`.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  FORMULARIO_PADRAO_DA_SALA, PERGUNTAS_POR_DOCUMENTO_SUGERIDAS, type FormularioDaSalaV1, type SalaDeTesteV1,
} from '@margem/contratos/sala';
import type { Id } from '@margem/contratos';
import { ErroDaApi, listarDocumentos } from '../biblioteca/api';
import type { Rota } from '../biblioteca/rotas';
import type { ItemDaBiblioteca } from '../biblioteca/tipos';
import { Icon } from '../ui/Icon';
import { Esqueleto } from '../ui/Esqueleto';
import { Button, Checkbox, Input, SegmentedControl, Switch, Textarea } from '../ui/Primitives';
import {
  criarSala, linkDaSala, listarSalas, mensagemDoConvite, mudarSala, obterSala,
  type PortaoConfigurado, type ResumoDaSala,
} from './api';
import { EditorDoFormulario, perguntasProntas } from './EditorDoFormulario';
import './sala.css';

type Ir = (destino: Rota, substituir?: boolean) => void;

export function situacaoDaSala(sala: Pick<SalaDeTesteV1, 'ativa' | 'expira_em'>, agora = Date.now()): { rotulo: string; classe: string } {
  if (!sala.ativa) return { rotulo: 'Fechada', classe: '' };
  if (sala.expira_em !== null && Date.parse(sala.expira_em) <= agora) return { rotulo: 'Vencida', classe: 'erro' };
  return { rotulo: 'Aberta', classe: 'ativo' };
}

export function Copiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }): ReactNode {
  const [copiado, copiar] = useState(false);
  useEffect(() => { if (!copiado) return; const tempo = setTimeout(() => copiar(false), 1800); return () => clearTimeout(tempo); }, [copiado]);
  return <Button onClick={() => { void navigator.clipboard?.writeText(texto).then(() => copiar(true), () => copiar(false)); }}>
    <Icon name={copiado ? 'check' : 'copiar'} size={16} />{copiado ? 'Copiado' : rotulo}
  </Button>;
}

export function AvisoDoPortao({ portao }: { portao: PortaoConfigurado }): ReactNode {
  if (portao.configurada) return null;
  return <p className="aviso sala-aviso">O link aponta para <code>{portao.url}</code>, que só abre nesta máquina. Para mandar a alguém, exponha o portão
    (Tailscale Funnel ou Cloudflare Tunnel) e defina <code>MARGEM_PORTAO_URL</code> na API. O passo a passo está em <code>docs/beta/SALA-DE-TESTE.md</code>.</p>;
}

// ---------------------------------------------------------------- lista

export function SalasDeTeste({ ir }: { ir: Ir }): ReactNode {
  const [dados, definirDados] = useState<{ salas: ResumoDaSala[]; portao: PortaoConfigurado } | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  useEffect(() => { listarSalas().then(definirDados, () => definirErro('Não foi possível carregar as salas.')); }, []);
  if (erro) return <div className="empty" role="alert"><p>{erro}</p></div>;
  if (!dados) return <Esqueleto />;
  return <div className="salas-do-leitor">
    <div className="cabeca-salas">
      <div><h1 className="page-title">Salas de teste</h1><p className="secundario">Abra alguns textos da biblioteca para quem vai testar o Margem, com uma senha e um formulário de feedback. Quem entra vê só os textos da sala.</p></div>
      <Button variante="primario" onClick={() => ir({ nome: 'nova-sala' })}><Icon name="adicionar" size={16} />Nova sala</Button>
    </div>
    <AvisoDoPortao portao={dados.portao} />
    {dados.salas.length === 0
      ? <section className="card sala-vazia"><div className="empty"><span className="empty-icon"><Icon name="bandeira" /></span><h2>Nenhuma sala ainda</h2><p>Crie a primeira: escolha os textos, a senha e o formulário. Depois é só mandar o link.</p></div></section>
      : <ul className="session-list lista-de-salas">
        {dados.salas.map((sala) => {
          const situacao = situacaoDaSala(sala);
          return <li key={sala.id}>
            <span className="session-dot" aria-hidden="true"><Icon name="bandeira" size={16} /></span>
            <div>
              <a className="titulo" href={`/salas/${sala.id}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'sala', sala_id: sala.id }); }}>{sala.titulo}</a>
              <span className="linha-meta">
                <span className={`badge ${situacao.classe}`}>{situacao.rotulo}</span>
                <span>{sala.documentos.length === 1 ? '1 texto' : `${String(sala.documentos.length)} textos`}</span>
                <span>{sala.testadores === 1 ? '1 testador' : `${String(sala.testadores)} testadores`}</span>
                <span>{sala.enviadas === 1 ? '1 formulário enviado' : `${String(sala.enviadas)} formulários enviados`}</span>
                <span>{sala.comentarios === 1 ? '1 comentário' : `${String(sala.comentarios)} comentários`}</span>
              </span>
            </div>
            <span className="button-row">
              <Button onClick={() => ir({ nome: 'sala', sala_id: sala.id })}>Respostas</Button>
              <Button variante="ghost" onClick={() => ir({ nome: 'sala', sala_id: sala.id, aba: 'editar' })}>Editar</Button>
            </span>
          </li>;
        })}
      </ul>}
  </div>;
}

// ---------------------------------------------------------------- criar e editar

function paraCampoDeData(iso: string | null): string {
  if (iso === null) return '';
  const data = new Date(iso);
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export interface Convite { sala: SalaDeTesteV1; senha: string; portao: PortaoConfigurado }

export function EditorDaSala({ sala_id, ir }: { sala_id?: Id; ir: Ir }): ReactNode {
  const [biblioteca, definirBiblioteca] = useState<ItemDaBiblioteca[] | null>(null);
  const [existente, definirExistente] = useState<SalaDeTesteV1 | null>(null);
  const [titulo, definirTitulo] = useState('');
  const [boasVindas, definirBoasVindas] = useState('Obrigado por testar o Margem! Leia com calma, comente o que quiser nos trechos e, no fim, responda o formulário.');
  const [documentos, definirDocumentos] = useState<Id[]>([]);
  const [modoDaSenha, definirModoDaSenha] = useState<'gerar' | 'digitar'>('gerar');
  const [senha, definirSenha] = useState('');
  const [validade, definirValidade] = useState('');
  const [ativa, definirAtiva] = useState(true);
  const [formulario, definirFormulario] = useState<FormularioDaSalaV1>(FORMULARIO_PADRAO_DA_SALA);
  const [erro, definirErro] = useState<string | null>(null);
  const [enviando, enviar] = useState(false);
  const [convite, definirConvite] = useState<Convite | null>(null);
  const [filtro, definirFiltro] = useState('');

  useEffect(() => {
    listarDocumentos().then(({ documentos: lista }) => definirBiblioteca(lista.filter((d) => d.texto_disponivel)), () => definirErro('Não foi possível carregar a biblioteca.'));
    if (!sala_id) return;
    obterSala(sala_id).then(({ sala }) => {
      definirExistente(sala); definirTitulo(sala.titulo); definirBoasVindas(sala.boas_vindas); definirDocumentos(sala.documentos);
      definirValidade(paraCampoDeData(sala.expira_em)); definirAtiva(sala.ativa); definirFormulario(sala.formulario);
    }, () => definirErro('Não foi possível carregar a sala.'));
  }, [sala_id]);

  const visiveis = useMemo(() => (biblioteca ?? []).filter((d) => filtro.trim() === '' || `${d.titulo} ${d.autor ?? ''}`.toLowerCase().includes(filtro.trim().toLowerCase())), [biblioteca, filtro]);
  const alternarDocumento = (id: Id, marcado: boolean) => definirDocumentos((atuais) => marcado ? [...atuais.filter((d) => d !== id), id] : atuais.filter((d) => d !== id));

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (documentos.length === 0) { definirErro('Escolha ao menos um texto.'); return; }
    if (!existente && modoDaSenha === 'digitar' && senha.length < 8) { definirErro('A senha precisa de ao menos 8 caracteres.'); return; }
    definirErro(null); enviar(true);
    const dados = {
      titulo: titulo.trim(), boas_vindas: boasVindas.trim(), documentos, ativa,
      expira_em: validade === '' ? null : new Date(validade).toISOString(),
      formulario: { versao: 1 as const, geral: perguntasProntas(formulario.geral), por_documento: perguntasProntas(formulario.por_documento) },
    };
    try {
      if (existente) {
        await mudarSala(existente.id, dados);
        ir({ nome: 'sala', sala_id: existente.id });
      } else {
        const criada = await criarSala({ ...dados, ...(modoDaSenha === 'digitar' ? { senha } : {}) });
        definirConvite({ sala: criada.sala, senha: criada.senha, portao: criada.portao });
        window.scrollTo(0, 0);
      }
    } catch (falha) {
      definirErro(falha instanceof ErroDaApi && falha.detalhe ? falha.detalhe : 'Não foi possível salvar a sala.');
    } finally { enviar(false); }
  }

  if (convite) return <ConviteDaSala convite={convite} ir={ir} />;
  if (biblioteca === null || (sala_id && !existente && !erro)) return <Esqueleto />;
  const porDocumento = formulario.por_documento.length > 0;
  return <div className="salas-do-leitor">
    <a className="voltar" href="/salas" onClick={(e) => { e.preventDefault(); ir(existente ? { nome: 'sala', sala_id: existente.id } : { nome: 'salas' }); }}><Icon name="voltar" size={18} />{existente ? 'Voltar às respostas' : 'Salas de teste'}</a>
    <h1 className="page-title">{existente ? 'Editar sala' : 'Nova sala de teste'}</h1>
    <form className="formulario editor-da-sala" onSubmit={(e) => void salvar(e)}>
      <section className="card">
        <h2 className="sala-subtitulo">A sala</h2>
        <div className="formulario">
          <label>Título<Input value={titulo} required maxLength={160} placeholder="Beta · primeira rodada" onChange={(e) => definirTitulo(e.target.value)} /></label>
          <label>Mensagem de boas-vindas<Textarea value={boasVindas} rows={3} maxLength={4000} onChange={(e) => definirBoasVindas(e.target.value)} /></label>
          <div className="dupla">
            <label><span>Fecha em <span className="secundario-inline">(opcional)</span></span><Input type="datetime-local" value={validade} onChange={(e) => definirValidade(e.target.value)} /></label>
            <div className="campo"><span>Situação</span><Switch checked={ativa} onChange={definirAtiva}>{ativa ? 'Aberta: aceita testadores' : 'Fechada: ninguém entra'}</Switch></div>
          </div>
          {!existente && <div className="campo">
            <span>Senha</span>
            <SegmentedControl rotulo="Senha" className="senha-modo" valor={modoDaSenha} aoMudar={(v) => definirModoDaSenha(v === 'digitar' ? 'digitar' : 'gerar')}
              opcoes={[{ valor: 'gerar', rotulo: 'Gerar uma' }, { valor: 'digitar', rotulo: 'Digitar' }]} />
            {modoDaSenha === 'digitar'
              ? <Input type="text" value={senha} minLength={8} maxLength={200} autoComplete="off" aria-label="Senha da sala" placeholder="Ao menos 8 caracteres" onChange={(e) => definirSenha(e.target.value)} />
              : <span className="secundario">Uma senha legível (como <code>k7mq-2xvt-9pha</code>) aparece uma vez, depois de criar a sala.</span>}
          </div>}
          {existente && <p className="secundario">A senha se troca na página de respostas da sala. Trocar a senha tira todo mundo que está dentro.</p>}
        </div>
      </section>

      <section className="card">
        <div className="hero-top"><h2 className="sala-subtitulo">Textos</h2><span className="secundario">{documentos.length === 1 ? '1 escolhido' : `${String(documentos.length)} escolhidos`}</span></div>
        <p className="secundario">Quem entra lê estes textos com as marcas e as notas da IA já publicadas. Não vê suas anotações, conversas nem o resto da biblioteca.</p>
        {biblioteca.length > 6 && <Input type="search" aria-label="Filtrar textos" placeholder="Filtrar pelo título ou autor" value={filtro} onChange={(e) => definirFiltro(e.target.value)} />}
        <ul className="escolha-de-documentos">
          {visiveis.map((documento) => <li key={documento.id}>
            <Checkbox checked={documentos.includes(documento.id)} onChange={(marcado) => alternarDocumento(documento.id, marcado)}>
              <span className="documento-escolhido"><span className="documento-escolhido-titulo">{documento.titulo}</span>
                <span className="documento-escolhido-meta">{[documento.autor, documento.formato === 'pdf' ? 'PDF' : 'Texto', documento.marcas.total > 0 ? (documento.marcas.total === 1 ? '1 marca' : `${String(documento.marcas.total)} marcas`) : 'sem marcas ainda'].filter(Boolean).join(' · ')}</span></span>
            </Checkbox>
          </li>)}
          {visiveis.length === 0 && <li className="secundario">Nenhum texto com esse filtro.</li>}
        </ul>
      </section>

      <section className="card">
        <div className="hero-top"><h2 className="sala-subtitulo">Formulário</h2><Button variante="ghost" onClick={() => definirFormulario(FORMULARIO_PADRAO_DA_SALA)}>Restaurar o modelo</Button></div>
        <p className="secundario">Perguntas gerais, respondidas uma vez. O modelo pronto cobre a primeira impressão, as marcas, o que confundiu e o que faltou.</p>
        <EditorDoFormulario rotulo="Perguntas gerais" perguntas={formulario.geral} aoMudar={(geral) => definirFormulario({ ...formulario, geral })} />
        <div className="por-documento-interruptor">
          <Switch checked={porDocumento} onChange={(ligar) => definirFormulario({ ...formulario, por_documento: ligar ? PERGUNTAS_POR_DOCUMENTO_SUGERIDAS : [] })}>Perguntas para cada texto</Switch>
          <span className="secundario">Repetidas em cada texto da sala.</span>
        </div>
        {porDocumento && <EditorDoFormulario rotulo="Perguntas por texto" perguntas={formulario.por_documento} aoMudar={(por_documento) => definirFormulario({ ...formulario, por_documento })} />}
      </section>

      {erro && <p className="aviso sala-aviso" role="alert">{erro}</p>}
      <div className="button-row"><Button type="submit" variante="primario" disabled={enviando}>{enviando ? 'Salvando…' : existente ? 'Salvar mudanças' : 'Criar sala'}</Button>
        <Button onClick={() => ir(existente ? { nome: 'sala', sala_id: existente.id } : { nome: 'salas' })}>Cancelar</Button></div>
    </form>
  </div>;
}

/** Depois de criar: o link, a mensagem pronta e a senha, que só aparece aqui. */
export function ConviteDaSala({ convite, ir }: { convite: Convite; ir: Ir }): ReactNode {
  const link = linkDaSala(convite.portao, convite.sala.slug);
  const mensagem = mensagemDoConvite(convite.sala.titulo, link, convite.sala.expira_em);
  return <div className="salas-do-leitor">
    <span className="eyebrow">Sala criada</span>
    <h1 className="page-title">{convite.sala.titulo}</h1>
    <AvisoDoPortao portao={convite.portao} />
    <section className="card convite">
      <div className="campo-copiavel"><span className="eyebrow">Link</span><code className="valor-copiavel">{link}</code><Copiar texto={link} rotulo="Copiar link" /></div>
      <div className="campo-copiavel"><span className="eyebrow">Senha</span><code className="valor-copiavel senha">{convite.senha}</code><Copiar texto={convite.senha} rotulo="Copiar senha" /></div>
      <p className="aviso sala-aviso">Anote a senha agora: ela não aparece de novo (o Margem guarda só um resumo dela). Mande a senha por outro canal, separada do link.</p>
      <label className="campo">Mensagem pronta<Textarea readOnly rows={9} value={mensagem} /></label>
      <div className="button-row"><Copiar texto={mensagem} rotulo="Copiar mensagem" /><Button variante="primario" onClick={() => ir({ nome: 'sala', sala_id: convite.sala.id })}>Ir para as respostas</Button></div>
    </section>
  </div>;
}
