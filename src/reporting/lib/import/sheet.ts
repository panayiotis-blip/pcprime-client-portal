// Reading a BTMS export into rows.
//
// Parsing happens in the browser rather than in an Edge Function, which is a
// deliberate departure from the table in BUILD.md §3 and is worth stating:
//
//  * §5 is the stronger rule -- "there is no service-role query path in the
//    application". An Edge Function writing 33.000 staged postings would
//    either hold the service key, which breaks that, or forward the caller's
//    JWT, at which point it is only a slower version of what the browser can
//    do directly.
//  * Every write below therefore goes through PostgREST under the signed-in
//    member of staff's own token, so RLS decides what lands, the same way it
//    decides everything else.
//  * The files are 5-8 MB and 35.000 rows; SheetJS handles them in well under
//    a second on the machines this runs on, and the prototype already did
//    exactly this.
//
// If a scheduled or emailed import is ever wanted, that is the point at which
// this moves server-side, and these parsers go with it unchanged -- they are
// pure functions over rows and import nothing from the browser.

import * as XLSX from 'xlsx';
import type { Row } from '../btms/types.ts';

export async function readSheetRows(file: File | Blob): Promise<Row[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[first], {
    header: 1,
    raw: true,
    defval: null,
  });
}

/** sha256 of the file exactly as it arrived, for the import record. */
export async function sha256(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
