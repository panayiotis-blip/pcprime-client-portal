/**
 * Every row, not just the first page.
 *
 * PostgREST answers a select with one page and says nothing about the rest.
 * Read as a chart of accounts, that silently drops 206 of A&F's 1.206 accounts
 * — which is how the client's own 2025 ledger came to be refused at 20 of 78
 * nominal codes when 59 of them were in the chart the whole time.
 *
 * A short register makes the fingerprint read as a mismatch, and that is the
 * one direction the check must never fail in quietly: it refuses the right
 * file, and teaches people to click past a refusal that is usually wrong.
 *
 * It lives here rather than in one importer because both of them read a
 * register that is larger than a page, and a fix that only one of them has is
 * a bug waiting for the other.
 */
const PAGE = 1000;

export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
