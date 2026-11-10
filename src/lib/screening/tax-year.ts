// The tax year a personal tax quote is for: until June, last year (returns due April 30);
// from July, this year. Toronto date YYYY-MM-DD in. Same rule as private.t1_tax_year in the database.
export function taxYearFor(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number);
  return m <= 6 ? y - 1 : y;
}
