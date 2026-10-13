/**
 * Recursos opcionais (J102): o que depende de infraestrutura própria (fábrica de voz, portão das salas,
 * importador do Horarium, aparelho e-ink) fica atrás de uma configuração
 * única, `MARGEM_RECURSOS`, lida pela API, pelo worker e pelas ferramentas que dependem deles.
 *
 *   MARGEM_RECURSOS=noticias,audio-colab,arte,sala,horarium,eink
 *
 * Sem a variável (instalação nova), só o padrão está ligado: `arte` (os Quadros fazem parte da V0,
 * J102b). A variável ACRESCENTA ao padrão; `-nome` tira (por exemplo `MARGEM_RECURSOS=-arte`).
 * Nomes separados por vírgula ou espaço, sem diferença de caixa; `audio` vale como `audio-colab`;
 * nome desconhecido é ignorado com aviso.
 *
 * - `noticias`: a página Notícias, a preparação diária no worker (coleta, edição, capa e narração por
 *   edge-tts) e as rotas `/api/noticias*`.
 * - `audio-colab`: a GERAÇÃO de voz pelo pipeline pessoal (fábrica auto-colab, OmniVoice, voz clonada):
 *   `narrar-visita`, `narrar-leitura-comentada`, `importar-audio`. Tocar áudio já publicado
 *   (`/api/audios/*`, `/api/narracoes-*`) não depende dela: outro provedor (J106) publica no mesmo lugar.
 * - `arte` (ligado por padrão): o acervo de quadros (`/api/arte*`, `/quadros`). Fica ligada mesmo sem
 *   acervo em disco (`MARGEM_ARTE_DIR`, padrão `<MARGEM_DADOS>/arte/obras`; `recursosEfetivos` em
 *   `http/app.ts` não confere a pasta, J110): as rotas mostram as obras de exemplo do repositório
 *   (`MARGEM_ARTE_FIXTURES=0` as tira) e `GET /api/arte` diz em `acervo` que nada foi instalado e como
 *   baixar o pacote, que a tela Quadros mostra como estado vazio. `MARGEM_ARTE=0` desliga, como `-arte`.
 * - `sala`: salas de teste do beta (`/api/salas*`) e o processo do portão.
 * - `horarium` (J102b): a importação de sessões do Horarium (`POST /api/importar/horarium`). O importador
 *   de marcas legadas (`/api/documentos/:id/importar-legado`) é genérico e não depende dela.
 * - `eink` (J102b): a versão para o Xteink X4 Pro: a tela `/eink/<documento>/<capítulo>`, o botão "Ver no
 *   e-ink" do leitor e o EPUB `GET /api/planos/:id/eink.epub`. A apresentação `?dispositivo=eink` do plano
 *   (`core/src/apresentacao.ts`) é só a divisão do plano em telas curtas e continua genérica.
 */
export const RECURSOS = ['noticias', 'audio-colab', 'arte', 'sala', 'horarium', 'eink'] as const;
export type Recurso = (typeof RECURSOS)[number];

const APELIDOS: Readonly<Record<string, Recurso>> = { audio: 'audio-colab' };

/** Ligados numa instalação nova, sem `MARGEM_RECURSOS`. */
export const RECURSOS_PADRAO: readonly Recurso[] = ['arte'];

const ehRecurso = (nome: string): nome is Recurso => (RECURSOS as readonly string[]).includes(nome);

/** Lê `MARGEM_RECURSOS`. `avisar` recebe cada nome desconhecido (padrão: uma linha JSON no stderr). */
export function recursosDoAmbiente(
  ambiente: NodeJS.ProcessEnv = process.env,
  avisar: (nome: string) => void = (nome) => { console.warn(JSON.stringify({ evento: 'recurso_desconhecido', nome })); },
): ReadonlySet<Recurso> {
  const ativos = new Set<Recurso>(RECURSOS_PADRAO);
  for (const bruto of (ambiente.MARGEM_RECURSOS ?? '').split(/[\s,]+/u)) {
    const termo = bruto.trim().toLowerCase();
    const negado = termo.startsWith('-');
    const nome = negado ? termo.slice(1) : termo;
    if (nome === '') continue;
    const recurso = APELIDOS[nome] ?? nome;
    if (!ehRecurso(recurso)) { avisar(nome); continue; }
    if (negado) ativos.delete(recurso);
    else ativos.add(recurso);
  }
  return ativos;
}

/** Na ordem canônica, para a API e os registros. */
export function listaDeRecursos(ativos: ReadonlySet<Recurso>): Recurso[] {
  return RECURSOS.filter((recurso) => ativos.has(recurso));
}

/** Para ferramentas de linha de comando: recusa com mensagem clara quando o recurso está desligado. */
export function exigirRecurso(recurso: Recurso, ambiente: NodeJS.ProcessEnv = process.env): void {
  if (recursosDoAmbiente(ambiente).has(recurso)) return;
  throw new Error(`O recurso ${recurso} está desligado nesta instalação. Ligue com MARGEM_RECURSOS=${recurso} (ver ops/desenvolvimento-local.md).`);
}
