/** Ensaio de PDF real com dados sintéticos e endpoints interceptados, sem API/banco. */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const fixture = JSON.parse(execFileSync('motor/.venv/bin/python', ['-c', `
import pymupdf as fitz
import json,base64
pdf=fitz.open(); paginas=[]; palavras=[]; blocos=[]
for i in range(2):
 p=pdf.new_page(); texto='Trecho de estudo na pagina '+str(i+1)
 p.insert_text((72,72),texto)
 blocos.append(dict(id='B'+str(i),ordem=i,tipo='paragrafo',texto=texto,inline=[],origens=[]))
 paginas.append(dict(numero=i+1,largura=p.rect.width,altura=p.rect.height,rotacao=0))
 inicio=0
 for x0,y0,x1,y1,t,*_ in p.get_text('words'):
  at=texto.index(t,inicio); inicio=at+len(t)
  palavras.append(dict(bloco_id='B'+str(i),inicio_utf16=at,fim_utf16=inicio,pagina=i+1,quad=[x0,y0,x1,y0,x1,y1,x0,y1]))
print(json.dumps(dict(pdf=base64.b64encode(pdf.tobytes()).decode(),blocos=blocos,geometria=dict(versao_id='V',fonte='pdf_texto',motor='teste',paginas=paginas,palavras=palavras))))
`], { encoding: 'utf8' }));
const origem = 'http://127.0.0.1:8766';
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage(); const erros = [];
 page.on('pageerror', e => erros.push(e.message));
 await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origem) return route.abort();
  if (url.pathname.endsWith('/original')) return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(fixture.pdf, 'base64') });
  if (url.pathname.endsWith('/geometria')) return route.fulfill({ json: fixture.geometria });
  if (url.pathname === '/benchmark-fixture.json') return route.fulfill({ json: { blocos: fixture.blocos } });
  return route.continue();
 });
 await page.goto(`${origem}/benchmark/pdf-leitor.html`);
 await page.locator('[data-pagina="1"] .pdf-conteudo[data-pronta]').waitFor();
 if (await page.locator('.pdf-alvos [data-marcas]').count() !== 2) throw new Error('Alvos não correspondem às duas páginas.');
 const linha = page.locator('[data-pagina="2"] [data-desenho="M1"] path.traco-linha').first();
 const antes = Number(await linha.getAttribute('stroke-width'));
 await page.getByRole('button', { name: 'Ativar segundo grifo' }).click();
 if (Number(await linha.getAttribute('stroke-width')) <= antes) throw new Error('Ativação não alterou o grifo correto.');
 await page.locator('[data-pagina="2"]').scrollIntoViewIfNeeded();
 await page.locator('[data-pagina="2"] .pdf-conteudo[data-pronta]').waitFor();
 await page.setViewportSize({ width: 600, height: 900 });
 await page.locator('[data-pagina="2"] .pdf-conteudo[data-pronta]').waitFor();
 if (erros.length || await page.getByRole('alert').count()) throw new Error(erros.join('; ') || 'Erro ao abrir PDF.');
 console.log('PDF real: duas páginas, dois alvos, ativação, rolagem e redimensionamento aprovados.');
} finally { await browser.close(); }
