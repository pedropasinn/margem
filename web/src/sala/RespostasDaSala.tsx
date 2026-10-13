/**
 * O que os testadores deixaram numa sala: médias das escalas e contagem das escolhas (só dos
 * formulários enviados), as respostas de cada pessoa, os comentários nos trechos (com link para o
 * trecho no leitor do dono) e a exportação em CSV. Daqui também se copia o convite, troca a
 * senha, fecha ou apaga a sala.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Id, PerguntaDaSalaV1, ValorDaRespostaDaSala } from '@margem/contratos';
import type { Rota } from '../biblioteca/rotas';
import { Icon } from '../ui/Icon';
import { Esqueleto } from '../ui/Esqueleto';
import { Button } from '../ui/Primitives';
import {
  apagarSala, csvDaSala, linkDaSala, listarSalas, mensagemDoConvite, mudarSala, relatorioDaSala, trocarSenhaDaSala,
  type PortaoConfigurado, type RelatorioDaSala, type TestadorNoRelatorio,
} from './api';
import { AvisoDoPortao, Copiar, situacaoDaSala } from './SalasDeTeste';
import './sala.css';

type Ir = (destino: Rota, substituir?: boolean) => void;
const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const decimal = (valor: number) => valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Valor({ pergunta, valor }: { pergunta: PerguntaDaSalaV1; valor: ValorDaRespostaDaSala | undefined }): ReactNode {
  if (valor === undefined || valor === '') return <span className="resposta-vazia">—</span>;
  if (pergunta.tipo === 'escala' && typeof valor === 'number') return <span className="resposta-escala"><span className="resposta-escala-numero">{valor}</span><span className="secundario"> de 5</span></span>;
  return <span className="resposta-texto">{String(valor)}</span>;
}

function Resumo({ pergunta, media, escolhas }: { pergunta: PerguntaDaSalaV1; media?: { media: number | null; respostas: number }; escolhas?: Record<string, number> }): ReactNode {
  if (pergunta.tipo === 'escala') {
    return <li className="resumo-da-pergunta"><span className="resumo-enunciado">{pergunta.enunciado}</span>
      <span className="resumo-valor">{media?.media === null || media === undefined ? '—' : decimal(media.media)}<span className="secundario"> · {media?.respostas ?? 0} {media?.respostas === 1 ? 'resposta' : 'respostas'}</span></span>
      <span className="progress-track" aria-hidden="true"><span style={{ width: `${String(((media?.media ?? 0) / 5) * 100)}%` }} /></span>
    </li>;
  }
  if (pergunta.tipo === 'escolha' && escolhas) {
    const total = Object.values(escolhas).reduce((a, b) => a + b, 0);
    return <li className="resumo-da-pergunta"><span className="resumo-enunciado">{pergunta.enunciado}</span>
      <span className="resumo-escolhas">{Object.entries(escolhas).map(([opcao, n]) => <span key={opcao} className="badge">{opcao} · {n}</span>)}</span>
      <span className="secundario">{total} {total === 1 ? 'resposta' : 'respostas'}</span>
    </li>;
  }
  return null;
}

function RespostasDoTestador({ testador, relatorio }: { testador: TestadorNoRelatorio; relatorio: RelatorioDaSala }): ReactNode {
  const { formulario } = relatorio.sala;
  const resposta = testador.resposta;
  return <details className="testador">
    <summary>
      <span className="testador-nome">{testador.nome}</span>
      <span className="linha-meta">
        <span className={`badge ${resposta?.estado === 'enviada' ? 'ativo' : ''}`}>{resposta === null ? 'Sem resposta' : resposta.estado === 'enviada' ? 'Enviado' : 'Rascunho'}</span>
        {testador.email && <span>{testador.email}</span>}
        <span>{resposta?.enviada_em ? `enviado em ${data(resposta.enviada_em)}` : `entrou em ${data(testador.criado_em)}`}</span>
        {testador.comentarios > 0 && <span>{testador.comentarios === 1 ? '1 comentário' : `${String(testador.comentarios)} comentários`}</span>}
      </span>
    </summary>
    {resposta === null ? <p className="secundario">Ainda não respondeu nada.</p> : <dl className="respostas-do-testador">
      {formulario.geral.map((pergunta) => <div key={pergunta.id}><dt>{pergunta.enunciado}</dt><dd><Valor pergunta={pergunta} valor={resposta.geral[pergunta.id]} /></dd></div>)}
      {formulario.por_documento.length > 0 && relatorio.documentos.map((documento) => formulario.por_documento.map((pergunta) =>
        <div key={`${documento.id}-${pergunta.id}`}><dt><span className="eyebrow">{documento.titulo}</span>{pergunta.enunciado}</dt><dd><Valor pergunta={pergunta} valor={resposta.por_documento[documento.id]?.[pergunta.id]} /></dd></div>))}
    </dl>}
  </details>;
}

export function RespostasDaSala({ sala_id, ir }: { sala_id: Id; ir: Ir }): ReactNode {
  const [relatorio, definirRelatorio] = useState<RelatorioDaSala | null>(null);
  const [portao, definirPortao] = useState<PortaoConfigurado | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [senhaNova, definirSenhaNova] = useState<string | null>(null);
  const [ocupado, ocupar] = useState(false);
  const carregar = useCallback(() => {
    Promise.all([relatorioDaSala(sala_id), listarSalas()]).then(([dados, lista]) => { definirRelatorio(dados); definirPortao(lista.portao); },
      () => definirErro('Não foi possível carregar as respostas.'));
  }, [sala_id]);
  useEffect(carregar, [carregar]);

  async function executar(acao: () => Promise<void>) {
    ocupar(true); definirErro(null);
    try { await acao(); } catch { definirErro('Não foi possível concluir a ação.'); } finally { ocupar(false); }
  }

  if (erro && !relatorio) return <div className="empty" role="alert"><p>{erro}</p></div>;
  if (!relatorio || !portao) return <Esqueleto />;
  const { sala } = relatorio;
  const situacao = situacaoDaSala(sala);
  const link = linkDaSala(portao, sala.slug);
  const enviadas = relatorio.testadores.filter((t) => t.resposta?.estado === 'enviada').length;
  const resumiveis = sala.formulario.geral.filter((p) => p.tipo === 'escala' || p.tipo === 'escolha');
  return <div className="salas-do-leitor respostas-da-sala">
    <a className="voltar" href="/salas" onClick={(e) => { e.preventDefault(); ir({ nome: 'salas' }); }}><Icon name="voltar" size={18} />Salas de teste</a>
    <div className="cabeca-salas">
      <div><span className={`badge ${situacao.classe}`}>{situacao.rotulo}</span><h1 className="page-title">{sala.titulo}</h1></div>
      <span className="button-row"><Button onClick={() => ir({ nome: 'sala', sala_id: sala.id, aba: 'editar' })}>Editar</Button></span>
    </div>
    <AvisoDoPortao portao={portao} />

    <section className="card convite convite-compacto">
      <div className="campo-copiavel"><span className="eyebrow">Link</span><code className="valor-copiavel">{link}</code><Copiar texto={link} rotulo="Copiar link" />
        <Copiar texto={mensagemDoConvite(sala.titulo, link, sala.expira_em)} rotulo="Copiar mensagem" /></div>
      {senhaNova && <div className="campo-copiavel"><span className="eyebrow">Senha nova</span><code className="valor-copiavel senha">{senhaNova}</code><Copiar texto={senhaNova} rotulo="Copiar senha" /></div>}
      <div className="button-row">
        <Button disabled={ocupado} onClick={() => { if (window.confirm('Trocar a senha tira todo mundo que está dentro da sala. Continuar?')) void executar(async () => { definirSenhaNova((await trocarSenhaDaSala(sala.id)).senha); }); }}>Gerar senha nova</Button>
        <Button disabled={ocupado} onClick={() => void executar(async () => { await mudarSala(sala.id, { ativa: !sala.ativa }); carregar(); })}>{sala.ativa ? 'Fechar a sala' : 'Reabrir a sala'}</Button>
        <Button variante="ghost" disabled={ocupado} onClick={() => { if (window.confirm('Apagar a sala apaga também as respostas e os comentários. Os textos da biblioteca não mudam. Continuar?')) void executar(async () => { await apagarSala(sala.id); ir({ nome: 'salas' }); }); }}>Apagar a sala</Button>
      </div>
      {erro && <p className="aviso sala-aviso" role="alert">{erro}</p>}
    </section>

    <div className="numeros-da-sala">
      <div><span className="numero-grande">{relatorio.testadores.length}</span><span className="secundario">{relatorio.testadores.length === 1 ? 'testador' : 'testadores'}</span></div>
      <div><span className="numero-grande">{enviadas}</span><span className="secundario">{enviadas === 1 ? 'formulário enviado' : 'formulários enviados'}</span></div>
      <div><span className="numero-grande">{relatorio.comentarios.length}</span><span className="secundario">{relatorio.comentarios.length === 1 ? 'comentário nos trechos' : 'comentários nos trechos'}</span></div>
    </div>

    {resumiveis.length > 0 && <section className="card">
      <div className="hero-top"><h2 className="sala-subtitulo">Resumo</h2><span className="secundario">Só os formulários enviados</span></div>
      <ul className="resumo-das-perguntas">
        {resumiveis.map((pergunta) => <Resumo key={pergunta.id} pergunta={pergunta} {...(relatorio.medias.geral[pergunta.id] ? { media: relatorio.medias.geral[pergunta.id] } : {})}
          {...(relatorio.escolhas.geral[pergunta.id] ? { escolhas: relatorio.escolhas.geral[pergunta.id] } : {})} />)}
      </ul>
    </section>}

    <section className="card">
      <div className="hero-top"><h2 className="sala-subtitulo">Por testador</h2><a className="ui-button ui-secundario" href={csvDaSala(sala.id, 'respostas')} download><Icon name="baixar" size={16} />Exportar CSV</a></div>
      {relatorio.testadores.length === 0 ? <p className="secundario">Ninguém entrou ainda.</p>
        : <div className="lista-de-testadores">{relatorio.testadores.map((testador) => <RespostasDoTestador key={testador.id} testador={testador} relatorio={relatorio} />)}</div>}
    </section>

    <section className="card">
      <div className="hero-top"><h2 className="sala-subtitulo">Comentários nos trechos</h2><a className="ui-button ui-secundario" href={csvDaSala(sala.id, 'comentarios')} download><Icon name="baixar" size={16} />Exportar CSV</a></div>
      {relatorio.comentarios.length === 0 ? <p className="secundario">Nenhum comentário ainda.</p>
        : <ul className="comentarios-da-sala">{relatorio.comentarios.map((comentario) => <li key={comentario.id}>
          <blockquote className="trecho-comentado">{comentario.citacao}</blockquote>
          <p className="comentario-texto">{comentario.texto}</p>
          <span className="linha-meta"><span>{comentario.testador}</span><span>{comentario.documento_titulo}</span><span>{data(comentario.criado_em)}</span>
            {comentario.secao_id && <a href={`/ler/${comentario.documento_id}/${comentario.secao_id}?bloco=${comentario.bloco_id}`}>Abrir o trecho</a>}</span>
        </li>)}</ul>}
    </section>
  </div>;
}
