// Piece UI1 (closebook specialist item 7): on screen a negative % reads in brackets, like the amounts ("-25.0%" becomes
// "(25.0%)"). Screens only: the PDFs and Excel files keep their own format.
export const pctShow = (t: string) => (/^-\d/.test(t) ? `(${t.slice(1)})` : t);
