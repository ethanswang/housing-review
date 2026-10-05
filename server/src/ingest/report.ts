import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ImportReport } from './importer.ts'

/** The counts, for the terminal. Details go to the JSON file. */
export function summarize(report: ImportReport): string {
  const c = report.counts
  return [
    `source: ${report.source}, area: within ${report.area.radiusKm} km of ${report.area.name}`,
    `  fetched              ${c.fetched}`,
    `  malformed            ${c.malformed}`,
    `  skipped              ${c.skipped}`,
    `  outside the area     ${c.outsideArea}`,
    `  inside the area      ${c.inArea}`,
    `    new properties     ${c.inserted}`,
    `    matched by id      ${c.matchedBySourceId} (${c.updated} updated, ${c.unchanged} unchanged)`,
    `    matched by address ${c.linkedByAddress}`,
    `    ambiguous          ${c.ambiguous}`,
    `    errors             ${c.errors}`,
    `  to review: ${report.review.length} notes, ${c.managersToReview} manager names`,
    report.applied ? 'Applied.' : 'Dry run: nothing was written. Re-run with --apply to write.',
  ].join('\n')
}

export function writeReport(report: ImportReport, path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}
