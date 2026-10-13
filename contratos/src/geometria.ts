import type { CanonicoV1, GeometriaV1 } from './tipos';
import { validarGeometria } from './validadores';
import { fronteiraUtf16 } from './regras';

/** Invariantes locais, também aplicadas ao arquivo sem canônico disponível. */
export function regrasGeometria(geometria: GeometriaV1): boolean {
  const paginas = new Map(geometria.paginas.map((pagina) => [pagina.numero, pagina]));
  if (paginas.size !== geometria.paginas.length) return false;
  const fins = new Map<string, number>();
  for (const palavra of geometria.palavras) {
    const pagina = paginas.get(palavra.pagina);
    if (!pagina || palavra.inicio_utf16 >= palavra.fim_utf16 || palavra.inicio_utf16 < (fins.get(palavra.bloco_id) ?? 0)) return false;
    if (palavra.quad.some((valor, indice) => !Number.isFinite(valor) || valor < -1 || valor > (indice % 2 ? pagina.altura : pagina.largura) + 1)) return false;
    fins.set(palavra.bloco_id, palavra.fim_utf16);
  }
  return true;
}

/** Conferência contextual; o envelope do serviço confere separadamente a versao_id. */
export function conferirGeometria(geometria: GeometriaV1, canonico: CanonicoV1): boolean {
  if (!validarGeometria(geometria)) return false;
  const blocos = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco]));
  return geometria.palavras.every((palavra) => {
    const bloco = blocos.get(palavra.bloco_id);
    if (!bloco || !bloco.origens.some((origem) => origem.tipo === 'pdf' && origem.pagina === palavra.pagina)) return false;
    const { inicio_utf16: inicio, fim_utf16: fim } = palavra;
    const texto = bloco.texto.slice(inicio, fim);
    return fim <= bloco.texto.length && fronteiraUtf16(bloco.texto, inicio) && fronteiraUtf16(bloco.texto, fim) && texto.length > 0 && texto.trim() === texto;
  });
}
