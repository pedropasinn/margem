import './estilos/legal.css';
import { montar } from './montar';
import { PaginaLegal, TERMOS } from './paginas/Legal';

montar(<PaginaLegal titulo="Termos de uso" atualizado="outubro de 2026" secoes={TERMOS} />);
