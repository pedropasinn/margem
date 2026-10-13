import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validarEditorialDeNoticias as validarEditorial, validarEdicaoDeNoticias as validarEdicao, validarCapaDeNoticias as validarCapa } from '@margem/contratos';
import type { CapaDeNoticiasV1, EdicaoDeNoticiasV1, EditorialDeNoticiasV1, FonteDaNoticiaV1 } from '@margem/contratos';

export const hash = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex');
export const schemaEditorial: unknown = JSON.parse(readFileSync(new URL('../../../contratos/schemas/EditorialDeNoticiasV1.schema.json', import.meta.url), 'utf8'));

export function conferirEditorial(valor: unknown, fontes: FonteDaNoticiaV1[], corte: string): EditorialDeNoticiasV1 {
  if (!validarEditorial(valor)) throw new Error('A edição não respeita o formato editorial.');
  if (valor.roteiro.trim().split(/\s+/u).filter(Boolean).length > 600) throw new Error('Roteiro acima de 600 palavras.');
  if (valor.noticias.length && !valor.roteiro.trim()) throw new Error('A edição precisa de roteiro.');
  const titulos = new Set<string>();
  for (const noticia of valor.noticias) {
    const chave = noticia.titulo.trim().toLocaleLowerCase('pt-BR');
    if (titulos.has(chave)) throw new Error('Matéria repetida na edição.');
    titulos.add(chave);
    for (const evidencia of noticia.evidencias) {
      const fonte = fontes.find(f => f.url === evidencia.fonte_url);
      if (!fonte || fonte.acesso !== 'pagina' || !fonte.texto.includes(evidencia.citacao) || !evidencia.citacao.trim()) {
        throw new Error('Evidência ausente do texto consultado.');
      }
    }
    if (noticia.natureza === 'novidade' && !noticia.evidencias.some(e => {
      const data = fontes.find(f => f.url === e.fonte_url)?.publicada_em;
      const idade = Date.parse(corte) - Date.parse(data ?? '');
      return Number.isFinite(idade) && idade >= 0 && idade <= 86400_000;
    })) noticia.natureza = 'repertorio';
  }
  return valor;
}

export function conferirEdicao(valor: unknown): EdicaoDeNoticiasV1 {
  if (!validarEdicao(valor)) throw new Error('Edição inválida.');
  const urls = new Set<string>();
  for (const fonte of valor.fontes) {
    if (urls.has(fonte.url) || hash(fonte.texto) !== fonte.sha256) throw new Error('Fonte duplicada ou alterada.');
    urls.add(fonte.url);
  }
  conferirEditorial({ titulo: valor.titulo, abertura: valor.abertura, roteiro: valor.roteiro, noticias: valor.noticias }, valor.fontes, valor.corte_em);
  return valor;
}

export function conferirNarracao(roteiro: string, hashRoteiro: string, duracao: number): void {
  if (hash(roteiro) !== hashRoteiro) throw new Error('O áudio pertence a outro roteiro.');
  if (!Number.isFinite(duracao) || duracao <= 0 || duracao > 300) throw new Error('Áudio fora do limite de cinco minutos.');
}

export function conferirCapa(valor: unknown): CapaDeNoticiasV1 {
  if (!validarCapa(valor)) throw new Error('Capa de notícias inválida.');
  return valor;
}
