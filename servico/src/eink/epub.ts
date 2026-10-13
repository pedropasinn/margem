/**
 * A leitura guiada de um capítulo como EPUB, para levar ao Xteink X4 Pro (e a qualquer leitor de
 * e-ink): as mesmas telas da carcaça web (`core/src/eink.ts`), uma por arquivo, para cada uma começar
 * numa página nova. Na tela de texto, os elementos do passo vêm sublinhados (tracejado = periférico)
 * e numerados; na de explicação, os mesmos números com o enunciado, as ligações (com um link para a
 * tela do outro trecho) e a parada.
 *
 * EPUB 3 com `toc.ncx` de EPUB 2, para leitores antigos. O zip é montado aqui mesmo, sem compressão
 * (o `mimetype` precisa ir primeiro e sem compressão; o resto é pequeno): nada de dependência nova.
 */
import { crc32 } from 'node:zlib';
import { ROTULO_DA_RELACAO_EINK, trechosDoBloco, type TelaDoEink } from '@margem/core';
import type { PlanoPedagogicoV1 } from '@margem/contratos';

export interface EntradaDoEpub {
  /** Identificador estável do livro gerado (o id do plano). */
  id: string;
  titulo: string;
  autor: string | null;
  capitulo: string;
  idioma: string;
  plano: PlanoPedagogicoV1;
  telas: readonly TelaDoEink[];
  /** Data da geração (ISO), para `dcterms:modified`. */
  gerado_em: string;
}

const escapar = (texto: string): string => texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const arquivoDaTela = (indice: number): string => `tela-${String(indice + 1).padStart(3, '0')}.xhtml`;

const ESTILO = `body { margin: 0 4%; font-family: serif; line-height: 1.5; color: #000; background: #fff; }
p { margin: 0 0 .7em; text-align: left; }
h1 { font-size: 1.3em; margin: 0 0 .8em; }
h2 { font-size: 1.1em; margin: 0 0 .6em; }
h3 { font-family: sans-serif; font-size: .75em; letter-spacing: .08em; text-transform: uppercase; margin: 1.2em 0 .4em; }
.cabeca { font-family: sans-serif; font-size: .7em; border-bottom: 1px solid #000; padding-bottom: .3em; margin-bottom: 1em; }
.grifo { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 2px; }
.periferico { text-decoration-style: dashed; text-decoration-thickness: 1px; }
.numero { font-family: sans-serif; font-size: .6em; font-weight: bold; vertical-align: super; border: 1px solid #000; border-radius: 1em; padding: 0 .3em; margin-left: .1em; }
.numero.periferico { border-style: dashed; }
.observar { font-style: italic; }
ol.itens, ul.ligacoes { padding-left: 1.2em; margin: 0 0 .6em; }
ol.itens li, ul.ligacoes li { margin-bottom: .5em; }
.parada { border-top: 1px solid #000; padding-top: .5em; margin-top: 1em; }
a { color: #000; }
`;

function xhtml(titulo: string, idioma: string, corpo: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapar(idioma)}" xml:lang="${escapar(idioma)}">
<head><meta charset="utf-8"/><title>${escapar(titulo)}</title><link rel="stylesheet" type="text/css" href="estilo.css"/></head>
<body>
${corpo}
</body>
</html>
`;
}

/** O conteúdo de cada tela, em XHTML. Texto do modelo e do livro sempre escapado. */
export function paginasDoEpub(entrada: EntradaDoEpub): string[] {
  const passos = entrada.plano.passos;
  return entrada.telas.map((tela, indice) => {
    const numero = passos.findIndex((passo) => passo.ordem === tela.passo) + 1;
    const passo = passos[numero - 1];
    const cabeca = `<p class="cabeca">${escapar(entrada.capitulo)} · passo ${String(numero)} de ${String(passos.length)} · ${String(indice + 1)}/${String(entrada.telas.length)}</p>`;
    if (tela.tipo === 'texto') {
      const blocos = tela.blocos.map((bloco) => {
        const trechos = trechosDoBloco(bloco.texto, tela.grifos[bloco.id] ?? []).map((trecho) => trecho.grifo
          ? `<span class="grifo${trecho.grifo.periferico ? ' periferico' : ''}">${escapar(trecho.texto)}</span><span class="numero${trecho.grifo.periferico ? ' periferico' : ''}">${String(trecho.grifo.numero)}</span>`
          : escapar(trecho.texto)).join('');
        return bloco.tipo === 'capitulo' || bloco.tipo === 'secao' ? `<h2>${trechos}</h2>` : `<p>${trechos}</p>`;
      }).join('\n');
      return xhtml(`${entrada.capitulo} · ${String(indice + 1)}`, entrada.idioma, `${cabeca}\n${blocos}`);
    }
    const explicacao = tela.texto.split(/\n\nObserve: /)[0] ?? tela.texto;
    const partes = [cabeca];
    if (passo) partes.push(`<p class="observar">${escapar(passo.observar)}</p>`);
    partes.push(...explicacao.split(/\n{2,}/).map((paragrafo) => `<p>${escapar(paragrafo)}</p>`));
    if (tela.itens.length > 0) {
      partes.push('<h3>No trecho</h3>', `<ol class="itens">${tela.itens.map((item) =>
        `<li value="${String(item.numero)}">${escapar(item.enunciado)}${item.periferico ? ' <em>(periférico)</em>' : ''}</li>`).join('')}</ol>`);
    }
    if (tela.ligacoes.length > 0) {
      partes.push('<h3>Ligações</h3>', `<ul class="ligacoes">${tela.ligacoes.map((ligacao) => {
        const rotulo = ROTULO_DA_RELACAO_EINK[ligacao.tipo];
        const citacao = ligacao.citacao ? ` <em>“${escapar(ligacao.citacao.length > 140 ? `${ligacao.citacao.slice(0, 140)}…` : ligacao.citacao)}”</em>` : '';
        const ir = ligacao.tela === null ? '' : ` <a href="${arquivoDaTela(ligacao.tela)}">tela ${String(ligacao.tela + 1)} ›</a>`;
        return `<li><strong>${escapar(rotulo)}${ligacao.retrospectiva ? ' · volta adiante' : ''}.</strong> ${escapar(ligacao.explicacao)}${citacao}${ir}</li>`;
      }).join('')}</ul>`);
    }
    if (tela.parada) partes.push(`<p class="parada"><strong>${tela.parada.tipo === 'pergunta' ? 'Antes de seguir' : 'Pausa'}.</strong> ${escapar(tela.parada.texto)}</p>`);
    return xhtml(`${entrada.capitulo} · ${String(indice + 1)}`, entrada.idioma, partes.join('\n'));
  });
}

export function montarEpub(entrada: EntradaDoEpub): Buffer {
  const paginas = paginasDoEpub(entrada);
  const titulo = `${entrada.titulo} — ${entrada.capitulo} (leitura guiada)`;
  const uid = `urn:margem:plano:${entrada.id}`;
  // O índice aponta a primeira tela de cada passo.
  const inicios = entrada.plano.passos.map((passo, numero) => ({ numero: numero + 1, observar: passo.observar, tela: entrada.telas.findIndex((tela) => tela.passo === passo.ordem) }))
    .filter((item) => item.tela >= 0);
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${escapar(entrada.idioma)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escapar(uid)}</dc:identifier>
<dc:title>${escapar(titulo)}</dc:title>
${entrada.autor ? `<dc:creator>${escapar(entrada.autor)}</dc:creator>\n` : ''}<dc:language>${escapar(entrada.idioma)}</dc:language>
<meta property="dcterms:modified">${escapar(entrada.gerado_em.replace(/\.\d+Z$/, 'Z'))}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="estilo" href="estilo.css" media-type="text/css"/>
${paginas.map((_pagina, indice) => `<item id="t${String(indice + 1)}" href="${arquivoDaTela(indice)}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${paginas.map((_pagina, indice) => `<itemref idref="t${String(indice + 1)}"/>`).join('\n')}
</spine>
</package>
`;
  const nav = xhtml(titulo, entrada.idioma, `<nav epub:type="toc" id="toc"><h1>${escapar(entrada.capitulo)}</h1><ol>
${inicios.map((item) => `<li><a href="${arquivoDaTela(item.tela)}">${String(item.numero)}. ${escapar(item.observar)}</a></li>`).join('\n')}
</ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapar(uid)}"/></head>
<docTitle><text>${escapar(titulo)}</text></docTitle>
<navMap>
${inicios.map((item, ordem) => `<navPoint id="p${String(item.numero)}" playOrder="${String(ordem + 1)}"><navLabel><text>${String(item.numero)}. ${escapar(item.observar)}</text></navLabel><content src="${arquivoDaTela(item.tela)}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`;
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  return zipSemCompressao([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', container],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/toc.ncx', ncx],
    ['OEBPS/estilo.css', ESTILO],
    ...paginas.map((pagina, indice): [string, string] => [`OEBPS/${arquivoDaTela(indice)}`, pagina]),
  ]);
}

/** Zip "stored" (método 0), o bastante para um EPUB: cabeçalhos locais, diretório central e fim. */
export function zipSemCompressao(arquivos: readonly (readonly [string, string])[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const [nome, conteudo] of arquivos) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const dados = Buffer.from(conteudo, 'utf8');
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nomeBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nomeBytes.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nomeBytes, dados);
    centrais.push(central, nomeBytes);
    deslocamento += local.length + nomeBytes.length + dados.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
