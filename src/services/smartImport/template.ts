import * as XLSX from 'xlsx';
import { IMPORT_FIELDS } from './fields';

// Generates and downloads a blank Smart Import template — an .xlsx whose
// header row is every importable client field. Staff fill in the rows and
// the file re-imports cleanly (headers match the field labels at 100%).
// Director fields are omitted (director import isn't supported yet).
export function downloadImportTemplate() {
  const headers = IMPORT_FIELDS
    .filter((f) => !f.key.startsWith('director_'))
    .map((f) => f.label);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  XLSX.writeFile(wb, 'smart-import-template.xlsx');
}
