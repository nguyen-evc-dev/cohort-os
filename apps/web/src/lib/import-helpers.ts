/** "hubspot-form-submissions-00_webinar_11_5_26-2026-10-24.csv" → "00_webinar_11_5_26" */
export function guessFormName(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, '')
    .replace(/^hubspot[-_ ]?form[-_ ]?submissions[-_ ]?/i, '')
    .replace(/[-_ ]?\d{4}-\d{2}-\d{2}.*$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .trim();
}
