import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Select } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import type { Rota, PaginaDeAjuda } from './rotas';
import { integracoes } from '../onboarding/integracoes';
import { lerTextoDoArquivo, motivoDaFalha, type ServicosDaImportacao } from './importacao';

/**
 * Entradas que não passam pela área de soltar: a extensão do navegador (páginas web), o Obsidian
 * (saída das marcas, não entrada de textos) e, em "Avançado", as marcas de outro arquivo para um
 * documento que já está na biblioteca (`POST /api/documentos/:id/importar-legado`).
 */
export function OutrasFontes({ ir }: { ir: (destino: Rota) => void }): ReactNode {
  const [extensao, obsidian] = integracoes();
  const ajuda = (pagina: PaginaDeAjuda) => (e: React.MouseEvent) => { e.preventDefault(); ir({ nome: 'ajuda', pagina }); };
  const destino = (link: string | null, pagina: PaginaDeAjuda, rotulo: string) => link
    ? <a className="button small" href={link} target="_blank" rel="noreferrer">{rotulo}<span className="apenas-leitores"> (nova aba)</span></a>
    : <a className="button small" href={`/ajuda/${pagina}`} onClick={ajuda(pagina)}>{rotulo}</a>;
  return <section className="importar-outras" aria-labelledby="importar-outras">
    <h2 id="importar-outras">Outras fontes</h2>
    <div className="importar-cartoes">
      <article className="cartao-fonte">
        <span className="cartao-fonte-icone" aria-hidden="true"><Icon name="navegador" size={20} /></span>
        <div><h3>Extensão do navegador</h3><p>Artigos, notícias e PDFs abertos no navegador, com um clique. É o caminho para qualquer página web.</p></div>
        {destino(extensao?.link ?? null, 'extensao', 'Instalar')}
      </article>
      <article className="cartao-fonte">
        <span className="cartao-fonte-icone" aria-hidden="true"><Icon name="video-doc" size={20} /></span>
        <div><h3>Vídeo e áudio próprios</h3><p>Solte o arquivo na área acima junto com a transcrição em JSON. O Margem ainda não transcreve sozinho; a transcrição vem do Whisper, fora do app.</p></div>
      </article>
      <article className="cartao-fonte">
        <span className="cartao-fonte-icone" aria-hidden="true"><Icon name="caderno" size={20} /></span>
        <div><h3>Obsidian</h3><p>No sentido contrário: leva suas marcas e notas daqui para o cofre, ligadas ao trecho.</p></div>
        {destino(obsidian?.link ?? null, 'obsidian', 'Saiba mais')}
      </article>
    </div>
  </section>;
}

interface DocumentoDaLista { id: string; titulo: string; versao_id: string | null }

/** Marcas de outro arquivo (formato MarcasLegadoV1) para um documento já preparado. */
export function ImportacaoAvancada({ ir, servicos }: { ir: (destino: Rota) => void; servicos: ServicosDaImportacao }): ReactNode {
  const [aberto, abrir] = useState(false);
  const [documentos, definirDocumentos] = useState<DocumentoDaLista[] | null>(null);
  const [escolhido, escolher] = useState('');
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [resultado, definirResultado] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [enviando, definirEnviando] = useState(false);
  const seletor = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!aberto || documentos !== null) return;
    servicos.listarDocumentos()
      .then(({ documentos: lista }) => definirDocumentos(lista.filter((documento) => documento.versao_id !== null)))
      .catch(() => definirDocumentos([]));
  }, [aberto, documentos, servicos]);
  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (!escolhido || !arquivo) return;
    definirEnviando(true); definirResultado(null);
    try {
      let corpo: unknown;
      try { corpo = JSON.parse(await lerTextoDoArquivo(arquivo)); } catch { throw new Error('O arquivo não é um JSON válido.'); }
      const { contagem } = await servicos.importarMarcas(escolhido, corpo);
      const gravadas = contagem.resolvidas + contagem.reconciliadas;
      definirResultado({ tipo: 'ok', texto: `${String(gravadas)} de ${String(contagem.total)} marcas entraram no documento.${gravadas < contagem.total ? ' As outras não foram localizadas no texto.' : ''}` });
    } catch (falha) {
      definirResultado({ tipo: 'erro', texto: motivoDaFalha(falha) });
    } finally { definirEnviando(false); }
  }
  return <section className="importar-avancado">
    <Button variante="ghost" className="small" aria-expanded={aberto} aria-controls="importar-avancado" onClick={() => abrir(!aberto)}>
      <Icon name="engrenagem" size={16} /> Avançado
    </Button>
    {aberto && <div id="importar-avancado" className="card importar-avancado-corpo">
      <h3>Marcas de outro arquivo</h3>
      <p className="importar-dica">Traz para um documento já preparado as marcas guardadas em JSON (formato <code>MarcasLegadoV1</code>, do Margem antigo). Cada marca é procurada pela citação literal; as que não forem achadas ficam de fora.</p>
      <form className="formulario" onSubmit={(e) => void aoEnviar(e)}>
        <div className="dupla">
          <label>Documento{documentos === null
            ? <span className="importar-dica" role="status">Carregando a biblioteca…</span>
            : documentos.length === 0 ? <span className="importar-dica">Nenhum documento com texto pronto.</span>
              : <Select aria-label="Documento" value={escolhido} onChange={(ev) => escolher(ev.target.value)}>
                <option value="">Escolher</option>
                {documentos.map((documento) => <option key={documento.id} value={documento.id}>{documento.titulo}</option>)}
              </Select>}</label>
          <div className="campo"><span>Arquivo de marcas</span><span className="escolher-arquivo">
            <input ref={seletor} type="file" hidden aria-label="Arquivo de marcas" accept=".json,application/json" onChange={(ev) => { definirArquivo(ev.target.files?.[0] ?? null); ev.target.value = ''; }} />
            <Button className="small" onClick={() => seletor.current?.click()}>Escolher arquivo</Button>{arquivo ? arquivo.name : 'Nenhum escolhido'}
          </span></div>
        </div>
        <div className="button-row">
          <Button type="submit" disabled={!escolhido || !arquivo || enviando}>{enviando ? 'Importando…' : 'Importar marcas'}</Button>
          {resultado?.tipo === 'ok' && escolhido && <a href={`/documentos/${escolhido}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'documento', documento_id: escolhido }); }}>Abrir o documento</a>}
        </div>
        {resultado && <p className={resultado.tipo === 'erro' ? 'aviso' : 'importar-dica'} role={resultado.tipo === 'erro' ? 'alert' : 'status'}>{resultado.texto}</p>}
      </form>
    </div>}
  </section>;
}
