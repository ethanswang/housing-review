import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ImportReport } from './importer.ts'

/** The counts, for the terminal. Details go to the JSON file. */
export function summarize(report: ImportReport): string {
  const c = report.counts
  return [
    `source: ${report.source}, area: within ${report.area.radiusKm} km of ${report.area.name}`,
    `  fetched             ${c.fetched}`,
    `  outside the area    ${c.outsideArea}`,
    `  new properties      ${c.inserted}`,
    `  matched by address  ${c.linkedByAddress}`,
    `  updated             ${c.updated}`,
    `  unchanged           ${c.unchanged}`,
    `  companies created   ${c.companiesCreated}`,
    `  ambiguous           ${c.ambiguous}`,
    `  skipped             ${c.skipped}`,
    `  errors              ${c.errors}`,
    report.applied ? 'Applied.' : 'Dry run: nothing was written.',
  ].join('\n')
}

export function writeReport(report: ImportReport, path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}
