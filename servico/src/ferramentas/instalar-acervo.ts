/**
 * Instala o pacote do acervo de quadros (J110; ver `../arte/pacote.ts`) em `MARGEM_ARTE_DIR`
 * (na imagem Docker, `/dados/arte/obras`, dentro do volume de dados).
 *
 *   npm run arte:instalar                      baixa e instala o pacote publicado (pacote-publicado.ts)
 *   npm run arte:instalar -- <arquivo|url> [--sha256 <hex>]
 *
 * Confere o manifesto, o SHA-256 de cada arquivo e cada obra antes de mover qualquer coisa. Rodar de novo
 * não muda nada. Saída 0: instalado (ou já estava); 1: pacote recusado; 64: uso.
 */
import { raizDoAcervo } from '../arte/acervo.js';
import { instalarPacote } from '../arte/pacote.js';
import { pacoteParaBaixar } from '../arte/pacote-publicado.js';

const args = process.argv.slice(2);
const i = args.indexOf('--sha256');
const sha256 = i >= 0 ? args[i + 1] : undefined;
const posicionais = args.filter((a, j) => !a.startsWith('--') && args[j - 1] !== '--sha256');
const publicado = pacoteParaBaixar();
const pacote = posicionais[0] ?? publicado.url;
if (!pacote) {
  const docker = (process.env.MARGEM_MODO ?? '').trim().toLowerCase() === 'instalado';
  console.error(`O pacote do acervo ainda não foi publicado. Com o arquivo em mãos: ${docker ? `${process.env.MARGEM_COMANDO?.trim() || 'margem'} arte instalar <arquivo.tar.gz>` : 'npm run arte:instalar -- <arquivo.tar.gz>'}`);
  process.exit(64);
}
const raiz = raizDoAcervo();
try {
  const r = await instalarPacote({ pacote, raiz, ...(sha256 ? { sha256 } : {}), avisar: (m) => { console.error(m); } });
  if (r.ja_instalado) console.log(`O acervo ${r.versao} já estava instalado em ${raiz}; nada mudou.`);
  else console.log(`Acervo ${r.versao} instalado em ${raiz}: ${String(r.instaladas.length)} obras novas, ${String(r.atualizadas.length)} atualizadas, ${String(r.iguais.length)} iguais.`);
  for (const c of r.conflitos) console.log(`  ${c.slug}: mantida como estava (${c.motivo})`);
  console.log('Abra Quadros na Biblioteca (recarregue a página).');
} catch (erro) {
  console.error(`Pacote recusado: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
}
