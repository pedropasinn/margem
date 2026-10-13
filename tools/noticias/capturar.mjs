// Evidência visual com dados sintéticos identificados; todas as requisições de API são interceptadas.
import { mkdir, writeFile } from 'node:fs/promises';
import { firefox } from 'playwright';

const pasta = 'docs/jobs/J95-evidencias';
await mkdir(pasta, { recursive: true });
const id = '00000000000000000000000001';
const noticia = { titulo: 'Citações que levam de volta ao documento', resumo: 'Exemplo sintético para conferir a interface: um extrator preserva o vínculo entre cada informação e o trecho original.', importancia: 'No Margem, vale comparar a precisão das citações antes de trocar o extrator. A aplicação continua sendo uma proposta.', projeto: 'Margem', natureza: 'novidade', limite: 'Conteúdo de teste visual. Não é uma notícia real.', evidencias: [{ fonte_url: 'https://example.org/fonte', citacao: 'Uma citação precisa voltar ao trecho correto.' }] };
const hub = { agenda: { ativa: true, hora: 7, fuso: 'America/Sao_Paulo', foco: 'ia_aplicada' }, edicoes: [{ id, dia: '2026-10-05', estado: 'ok', diagnostico: null, documento_id: null, capa: { descricao: 'Capa sintética para teste de interface', largura: 1200, altura: 800, sha256: 'b'.repeat(64), sha256_edicao: 'c'.repeat(64), bytes: 1000 }, estado_capa: 'ok', audio: { duracao_s: 199, sha256_roteiro: 'a'.repeat(64) }, estado_audio: 'ok', conteudo: { versao: 1, foco: 'ia_aplicada', corte_em: '2026-10-05T10:00:00Z', titulo: 'Entre a novidade e o que vale usar', abertura: 'Edição sintética de teste visual. Uma seleção curta para acompanhar IA sem perder a ligação com os seus projetos.', roteiro: 'Este é o roteiro de teste visual.', noticias: [noticia, { ...noticia, titulo: 'Como avaliar uma resposta de pesquisa', projeto: 'Gibraltar', natureza: 'repertorio' }], fontes: [{ url: 'https://example.org/fonte', titulo: 'Fonte sintética', publicada_em: '2026-10-05T09:00:00Z', texto: noticia.evidencias[0].citacao, sha256: 'a'.repeat(64), acesso: 'pagina' }], cobertura: [{ nome: 'Fonte de teste', url: 'https://example.org/feed', estado: 'parcial', candidatos: 8, lidos: 3, limite: 'Limite simulado para a inspeção visual.' }] } }] };
const anterior = structuredClone(hub.edicoes[0]);
anterior.id = '00000000000000000000000002'; anterior.dia = '2026-09-30';
anterior.conteudo.titulo = 'Retrospectiva — Avaliar antes de integrar';
anterior.conteudo.abertura = 'Edição sintética para conferir o arquivo: avaliações de agentes, pesquisa e documentos, com fontes para aprofundar.';
hub.edicoes.push(anterior);
// WAV PCM silencioso para a prévia offline do player.
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(16036, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write('data', 36); audio.writeUInt32LE(16000, 40);
const browser = await firefox.launch();
const verificacoes = [];
try {
  for (const largura of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width: largura, height: 1000 } });
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/capa')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#eee9df"/><path d="M300 580V210L830 160V530Z" fill="#42615c"/><path d="M430 620V300L950 240V560Z" fill="#c17d5b"/><text x="70" y="730" font-size="32">CAPA SINTÉTICA · TESTE DE INTERFACE</text></svg>' });
      if (url.pathname.endsWith('/audio')) return route.fulfill({ status: 200, contentType: 'audio/wav', body: audio });
      if (url.pathname.includes('/eventos')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': teste\n\n' });
      const body = url.pathname === '/api/noticias' ? hub : url.pathname === '/api/documentos' ? { documentos: [{ id }] } : { versao: 1, execucoes: [], documentos: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('http://127.0.0.1:5195/noticias', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: hub.edicoes[0].conteudo.titulo }).waitFor();
    await page.screenshot({ path: `${pasta}/inicio-${largura}.png`, fullPage: true });
    const inicioSemExcedente = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const semSeletor = await page.getByRole('combobox').count() === 0;
    await page.getByRole('link', { name: hub.edicoes[0].conteudo.titulo, exact: true }).click();
    await page.getByRole('link', { name: '← Todas as edições' }).waitFor();
    const excedente = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: `${pasta}/noticias-${largura}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Gibraltar', exact: true }).click();
    const filtrou = await page.getByRole('heading', { name: noticia.titulo }).count() === 0;
    await page.getByRole('button', { name: 'Sua edição', exact: true }).click();
    const agenda = await page.getByRole('checkbox').isChecked();
    await page.screenshot({ path: `${pasta}/preferencias-${largura}.png`, fullPage: true });
    verificacoes.push({ largura, excedente, inicioSemExcedente, semSeletor, filtrou, agenda, erros });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${pasta}/visual.json`, JSON.stringify(verificacoes, null, 2));
console.log(JSON.stringify(verificacoes));
if (verificacoes.some(v => v.excedente || !v.inicioSemExcedente || !v.semSeletor || !v.filtrou || !v.agenda || v.erros.length)) process.exitCode = 1;
