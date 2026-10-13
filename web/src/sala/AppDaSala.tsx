/**
 * A sala de teste vista pelo testador, servida pelo portão em `/t/<slug>`: entrada com nome e
 * senha, capa (boas-vindas, documentos, progresso do formulário), o leitor em modo restrito e o
 * formulário de feedback. Nada aqui conhece a biblioteca do dono: só a capa da sala.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Id, ValorDaRespostaDaSala } from '@margem/contratos';
import { ErroDaApi } from '../biblioteca/api';
import { BarraDeProgresso, Icon } from '../ui/Icon';
import { Esqueleto } from '../ui/Esqueleto';
import { Button, Input } from '../ui/Primitives';
import { capaDaSala, entrarNaSala, gravarRespostas, sairDaSala, salaPublica, type CapaDaSala, type RespostasDoFormulario, type SalaPublica } from './api';
import { CamposDoFormulario, progressoDoFormulario } from './CamposDoFormulario';
import { LeitorDaSala } from './LeitorDaSala';
import './sala.css';

export type RotaDaSala = { nome: 'capa' } | { nome: 'formulario' } | { nome: 'leitura'; documento_id: Id; secao_id?: Id };

export function rotaDaSala(caminho: string): { slug: string; rota: RotaDaSala } | null {
  const partes = caminho.split('?')[0]?.split('/').filter((parte) => parte !== '') ?? [];
  if (partes[0] !== 't' || !partes[1]) return null;
  const slug = partes[1];
  if (partes[2] === 'formulario') return { slug, rota: { nome: 'formulario' } };
  if (partes[2] === 'ler' && partes[3]) return { slug, rota: partes[4] ? { nome: 'leitura', documento_id: partes[3], secao_id: partes[4] } : { nome: 'leitura', documento_id: partes[3] } };
  return { slug, rota: { nome: 'capa' } };
}

export function caminhoDaSala(slug: string, rota: RotaDaSala): string {
  if (rota.nome === 'formulario') return `/t/${slug}/formulario`;
  if (rota.nome === 'leitura') return `/t/${slug}/ler/${rota.documento_id}${rota.secao_id ? `/${rota.secao_id}` : ''}`;
  return `/t/${slug}`;
}

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'inexistente' }
  | { tipo: 'fechada'; sala: SalaPublica }
  | { tipo: 'entrada'; sala: SalaPublica }
  | { tipo: 'dentro'; capa: CapaDaSala }
  | { tipo: 'erro'; mensagem: string };

export function AppDaSala({ slug, rotaInicial }: { slug: string; rotaInicial: RotaDaSala }): ReactNode {
  const [estado, definirEstado] = useState<Estado>({ tipo: 'carregando' });
  const [rota, definirRota] = useState<RotaDaSala>(rotaInicial);
  const ir = useCallback((destino: RotaDaSala, substituir = false) => {
    const caminho = caminhoDaSala(slug, destino);
    if (substituir) window.history.replaceState(null, '', caminho); else window.history.pushState(null, '', caminho);
    definirRota(destino);
    if (destino.nome !== 'leitura') window.scrollTo(0, 0);
  }, [slug]);
  useEffect(() => {
    const voltar = () => { const lida = rotaDaSala(window.location.pathname); if (lida) definirRota(lida.rota); };
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const { sala, dentro } = await salaPublica(slug);
      if (!sala.aberta) { definirEstado({ tipo: 'fechada', sala }); return; }
      if (!dentro) { definirEstado({ tipo: 'entrada', sala }); return; }
      definirEstado({ tipo: 'dentro', capa: await capaDaSala(slug) });
    } catch (falha) {
      if (falha instanceof ErroDaApi && falha.status === 404) { definirEstado({ tipo: 'inexistente' }); return; }
      definirEstado({ tipo: 'erro', mensagem: 'Não foi possível abrir a sala agora. Tente de novo em instantes.' });
    }
  }, [slug]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    document.title = estado.tipo === 'dentro' ? `${estado.capa.sala.titulo} · Margem` : estado.tipo === 'entrada' || estado.tipo === 'fechada' ? `${estado.sala.titulo} · Margem` : 'Margem';
  }, [estado]);

  const atualizarResposta = useCallback((resposta: CapaDaSala['resposta']) => {
    definirEstado((atual) => atual.tipo === 'dentro' ? { tipo: 'dentro', capa: { ...atual.capa, resposta } } : atual);
  }, []);
  const sair = useCallback(async () => { await sairDaSala(slug).catch(() => undefined); await carregar(); ir({ nome: 'capa' }, true); }, [slug, carregar, ir]);

  if (estado.tipo === 'carregando') return <Esqueleto />;
  if (estado.tipo === 'inexistente') return <TelaSimples titulo="Link inválido" texto="Confira o endereço que você recebeu. Se o problema continuar, peça um link novo a quem convidou você." />;
  if (estado.tipo === 'erro') return <TelaSimples titulo="Algo deu errado" texto={estado.mensagem} />;
  if (estado.tipo === 'fechada') return <TelaSimples eyebrow={estado.sala.titulo} titulo="Esta sala de teste está fechada" texto="Obrigado pelo interesse! Se ainda quiser testar, fale com quem convidou você." />;
  if (estado.tipo === 'entrada') return <EntradaDaSala slug={slug} sala={estado.sala} aoEntrar={() => void carregar()} />;

  const { capa } = estado;
  // Sessão vencida ou sala fechada no meio do caminho: volta para a entrada.
  const perdeuSessao = () => { void carregar(); };
  if (rota.nome === 'leitura') {
    const documento = capa.documentos.find((item) => item.id === rota.documento_id);
    if (!documento) return <TelaSimples titulo="Documento fora da sala" texto="Este texto não faz parte desta sala." acao={<Button onClick={() => ir({ nome: 'capa' })}>Voltar à sala</Button>} />;
    return <LeitorDaSala key={documento.id} slug={slug} documento={documento} {...(rota.secao_id ? { secao_id: rota.secao_id } : {})}
      aoVoltar={() => ir({ nome: 'capa' })} aoIrCapitulo={(secao) => ir({ nome: 'leitura', documento_id: documento.id, secao_id: secao }, true)}
      aoPerderSessao={perdeuSessao} />;
  }
  if (rota.nome === 'formulario') return <FormularioDaSala slug={slug} capa={capa} aoVoltar={() => ir({ nome: 'capa' })} aoGravar={atualizarResposta} aoPerderSessao={perdeuSessao} />;
  return <Capa slug={slug} capa={capa} ir={ir} aoSair={() => void sair()} />;
}

function TelaSimples({ eyebrow, titulo, texto, acao }: { eyebrow?: string; titulo: string; texto: string; acao?: ReactNode }): ReactNode {
  return <main className="sala-pagina sala-centro" id="conteudo">
    <section className="card sala-cartao" aria-labelledby="sala-titulo">
      <p className="sala-marca">Margem</p>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1 id="sala-titulo" className="sala-titulo-cartao">{titulo}</h1>
      <p className="sala-texto">{texto}</p>
      {acao && <div className="button-row">{acao}</div>}
    </section>
  </main>;
}

function EntradaDaSala({ slug, sala, aoEntrar }: { slug: string; sala: SalaPublica; aoEntrar: () => void }): ReactNode {
  const [erro, definirErro] = useState<string | null>(null);
  const [enviando, enviar] = useState(false);
  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const campo = (nome: string) => { const valor = dados.get(nome); return typeof valor === 'string' ? valor : ''; };
    const nome = campo('nome').trim();
    const email = campo('email').trim();
    const senha = campo('senha');
    if (nome === '') { definirErro('Diga o seu nome.'); return; }
    definirErro(null); enviar(true);
    try {
      await entrarNaSala(slug, { nome, senha, ...(email === '' ? {} : { email }) });
      aoEntrar();
    } catch (falha) {
      definirErro(falha instanceof ErroDaApi && falha.detalhe ? falha.detalhe : 'Não foi possível entrar. Tente de novo.');
    } finally { enviar(false); }
  }
  return <main className="sala-pagina sala-centro" id="conteudo">
    <section className="card sala-cartao" aria-labelledby="sala-titulo">
      <p className="sala-marca">Margem</p>
      <span className="eyebrow">Sala de teste</span>
      <h1 id="sala-titulo" className="sala-titulo-cartao">{sala.titulo}</h1>
      <p className="sala-texto">Você foi convidado para testar um leitor de textos com marcas e notas na margem.</p>
      <form className="formulario sala-entrada" onSubmit={(e) => void entrar(e)}>
        <label>Seu nome<Input name="nome" autoComplete="name" required maxLength={120} autoFocus /></label>
        <label><span>E-mail <span className="secundario-inline">(opcional)</span></span><Input name="email" type="email" autoComplete="email" maxLength={254} /></label>
        <label>Senha<Input name="senha" type="password" autoComplete="current-password" required /></label>
        {erro && <p className="aviso sala-aviso" role="alert">{erro}</p>}
        <Button type="submit" variante="primario" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</Button>
      </form>
      <p className="sala-rodape">O seu nome aparece só para quem convidou você, junto das suas respostas e comentários.</p>
    </section>
  </main>;
}

function Capa({ slug, capa, ir, aoSair }: { slug: string; capa: CapaDaSala; ir: (rota: RotaDaSala) => void; aoSair: () => void }): ReactNode {
  const ids = capa.documentos.map((documento) => documento.id);
  const progresso = progressoDoFormulario(capa.sala.formulario, ids, capa.resposta);
  const enviada = capa.resposta?.estado === 'enviada';
  const comentarios = capa.documentos.reduce((soma, documento) => soma + documento.comentarios, 0);
  return <main className="sala-pagina" id="conteudo">
    <header className="sala-topo">
      <span className="sala-marca">Margem</span>
      <span className="sala-quem">{capa.testador.nome}<Button variante="ghost" onClick={aoSair}>Sair</Button></span>
    </header>
    <div className="sala-coluna">
      <span className="eyebrow">Sala de teste</span>
      <h1 className="sala-titulo">{capa.sala.titulo}</h1>
      {capa.sala.boas_vindas && <p className="sala-boas-vindas">{capa.sala.boas_vindas}</p>}
      <ol className="sala-passos">
        <li><strong>Leia</strong> um ou mais textos abaixo. As cores e as notas na margem foram feitas pela IA do Margem.</li>
        <li><strong>Comente</strong> o que quiser: selecione um trecho e toque em “Comentar”.</li>
        <li><strong>Responda</strong> o formulário no fim. Dá para salvar e voltar depois.</li>
      </ol>

      <h2 className="sala-subtitulo">Textos</h2>
      <ul className="session-list sala-documentos">
        {capa.documentos.map((documento) => <li key={documento.id}>
          <span className="session-dot" aria-hidden="true"><Icon name={documento.formato === 'pdf' ? 'pdf' : documento.capitulos > 1 ? 'livro' : 'texto'} size={16} /></span>
          <div>
            <a className="titulo" href={caminhoDaSala(slug, { nome: 'leitura', documento_id: documento.id })}
              onClick={(e) => { e.preventDefault(); ir({ nome: 'leitura', documento_id: documento.id }); }}>{documento.titulo}</a>
            <span className="linha-meta">
              {documento.autor && <span>{documento.autor}</span>}
              <span>{documento.capitulos > 1 ? `${String(documento.capitulos)} capítulos` : documento.formato === 'pdf' ? 'PDF' : 'Texto'}</span>
              {documento.comentarios > 0 && <span>{documento.comentarios === 1 ? '1 comentário seu' : `${String(documento.comentarios)} comentários seus`}</span>}
            </span>
          </div>
          <Button onClick={() => ir({ nome: 'leitura', documento_id: documento.id })}>Ler</Button>
        </li>)}
      </ul>

      <section className="card sala-formulario-cartao" aria-labelledby="sala-formulario-titulo">
        <div className="hero-top"><h2 id="sala-formulario-titulo" className="sala-subtitulo">Formulário</h2>{enviada && <span className="badge ativo">Enviado</span>}</div>
        <p className="sala-texto">{enviada
          ? 'Obrigado! Você ainda pode mudar as respostas enquanto a sala estiver aberta.'
          : progresso.respondidas === 0 ? 'Leva uns 5 minutos. Responda depois de ler.' : 'Rascunho salvo. Continue de onde parou.'}</p>
        <BarraDeProgresso valor={progresso.total === 0 ? 0 : (progresso.respondidas / progresso.total) * 100} rotulo="Perguntas respondidas" />
        <div className="sala-formulario-rodape">
          <span className="secundario">{progresso.respondidas} de {progresso.total} respondidas{comentarios > 0 ? ` · ${String(comentarios)} ${comentarios === 1 ? 'comentário' : 'comentários'} nos trechos` : ''}</span>
          <Button variante={enviada ? 'secundario' : 'primario'} onClick={() => ir({ nome: 'formulario' })}>{enviada ? 'Ver respostas' : progresso.respondidas === 0 ? 'Responder' : 'Continuar'}</Button>
        </div>
      </section>
      {capa.sala.expira_em && <p className="sala-rodape">A sala fica aberta até {new Date(capa.sala.expira_em).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}.</p>}
    </div>
  </main>;
}

type Gravacao = 'ocioso' | 'salvando' | 'salvo' | 'erro';

function FormularioDaSala({ slug, capa, aoVoltar, aoGravar, aoPerderSessao }: {
  slug: string; capa: CapaDaSala; aoVoltar: () => void; aoGravar: (resposta: CapaDaSala['resposta']) => void; aoPerderSessao: () => void;
}): ReactNode {
  const { formulario } = capa.sala;
  const [respostas, definirRespostas] = useState<RespostasDoFormulario>(() => ({ geral: { ...(capa.resposta?.geral ?? {}) }, por_documento: structuredClone(capa.resposta?.por_documento ?? {}) }));
  const [gravacao, definirGravacao] = useState<Gravacao>('ocioso');
  const [erro, definirErro] = useState<string | null>(null);
  const [faltando, definirFaltando] = useState<ReadonlySet<string>>(new Set());
  const enviada = capa.resposta?.estado === 'enviada';
  const [enviando, definirEnviando] = useState(false);
  const sujo = useRef(false);
  const respostasRef = useRef(respostas); respostasRef.current = respostas;

  const mudar = (documento: Id | null, id: string, valor: ValorDaRespostaDaSala | null) => {
    sujo.current = true;
    definirRespostas((atual) => {
      const grupo = { ...(documento === null ? atual.geral : atual.por_documento[documento] ?? {}) };
      if (valor === null) delete grupo[id]; else grupo[id] = valor;
      return documento === null ? { ...atual, geral: grupo } : { ...atual, por_documento: { ...atual.por_documento, [documento]: grupo } };
    });
    definirFaltando((atual) => { if (!atual.has(id)) return atual; const novo = new Set(atual); novo.delete(id); return novo; });
  };

  // Rascunho: salva sozinho um instante depois da última mudança (só antes do envio).
  useEffect(() => {
    if (enviada || !sujo.current) return;
    const tempo = setTimeout(() => {
      sujo.current = false;
      definirGravacao('salvando');
      gravarRespostas(slug, respostasRef.current, false).then(({ resposta }) => { aoGravar(resposta); definirGravacao('salvo'); }, (falha: unknown) => {
        if (falha instanceof ErroDaApi && falha.status === 404) { aoPerderSessao(); return; }
        definirGravacao('erro');
      });
    }, 900);
    return () => clearTimeout(tempo);
  }, [respostas, enviada, slug, aoGravar, aoPerderSessao]);

  async function enviar() {
    definirErro(null); definirEnviando(true);
    try {
      const { resposta } = await gravarRespostas(slug, respostas, true);
      sujo.current = false;
      aoGravar(resposta);
      definirGravacao('salvo');
      definirFaltando(new Set());
      window.scrollTo({ top: 0 });
    } catch (falha) {
      if (falha instanceof ErroDaApi && falha.status === 404) { aoPerderSessao(); return; }
      if (falha instanceof ErroDaApi && falha.codigo === 'obrigatorias_sem_resposta') {
        const ids = new Set((falha.detalhe ?? '').split(',').map((campo) => campo.trim().split('.').at(-1) ?? '').filter((id) => id !== ''));
        definirFaltando(ids);
        definirErro('Faltam respostas obrigatórias (marcadas com *).');
        setTimeout(() => document.querySelector('[data-falta]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      } else definirErro(falha instanceof ErroDaApi && falha.detalhe ? falha.detalhe : 'Não foi possível enviar. Tente de novo.');
    } finally { definirEnviando(false); }
  }
  const situacao = useMemo(() => enviada ? `Enviado em ${new Date(capa.resposta?.enviada_em ?? '').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    : gravacao === 'salvando' ? 'Salvando rascunho…' : gravacao === 'salvo' ? 'Rascunho salvo' : gravacao === 'erro' ? 'Não foi possível salvar o rascunho' : 'O rascunho salva sozinho',
  [enviada, gravacao, capa.resposta?.enviada_em]);

  return <main className="sala-pagina" id="conteudo">
    <header className="sala-topo">
      <a className="voltar" href={`/t/${slug}`} onClick={(e) => { e.preventDefault(); aoVoltar(); }}><Icon name="voltar" size={18} />Voltar à sala</a>
      <span className="secundario" role="status">{situacao}</span>
    </header>
    <div className="sala-coluna">
      <span className="eyebrow">{capa.sala.titulo}</span>
      <h1 className="sala-titulo">Formulário</h1>
      {enviada && <p className="aviso sala-aviso sala-enviado" role="status">Obrigado, {capa.testador.nome}! As respostas chegaram. Se quiser mudar algo, edite e envie de novo.</p>}
      <form className="formulario sala-formulario" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <CamposDoFormulario perguntas={formulario.geral} valores={respostas.geral} faltando={faltando} aoMudar={(id, valor) => mudar(null, id, valor)} />
        {formulario.por_documento.length > 0 && capa.documentos.map((documento) => <section key={documento.id} className="sala-por-documento" aria-label={`Sobre ${documento.titulo}`}>
          <h2 className="sala-por-documento-titulo"><span className="eyebrow">Sobre o texto</span>{documento.titulo}</h2>
          <CamposDoFormulario perguntas={formulario.por_documento} valores={respostas.por_documento[documento.id] ?? {}} faltando={faltando}
            aoMudar={(id, valor) => mudar(documento.id, id, valor)} />
        </section>)}
        {erro && <p className="aviso sala-aviso" role="alert">{erro}</p>}
        <div className="button-row sala-enviar">
          <Button type="submit" variante="primario" disabled={enviando}>{enviando ? 'Enviando…' : enviada ? 'Enviar de novo' : 'Enviar respostas'}</Button>
          <Button onClick={aoVoltar}>Voltar à sala</Button>
        </div>
      </form>
    </div>
  </main>;
}
