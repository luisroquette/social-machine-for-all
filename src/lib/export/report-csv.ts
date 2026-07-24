/**
 * Generate a CSV file from structured markdown data.
 * Extracts ALL tables from a markdown report into one CSV with section separators.
 */

interface TableBlock {
  title: string | null
  headers: string[]
  rows: Array<Record<string, string>>
}

/**
 * Extract all markdown tables from text.
 * Tracks the nearest preceding heading as the table title.
 */
export function extractTableFromMarkdown(text: string): TableBlock[] {
  const lines = text.split('\n')
  const tables: TableBlock[] = []
  let lastHeading: string | null = null
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // Track headings as potential table titles
    if (trimmed.startsWith('#')) {
      lastHeading = trimmed.replace(/^#+\s*/, '').trim()
      i++
      continue
    }

    // Detect start of a table block
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length) {
        const tl = lines[i].trim()
        if (tl.startsWith('|') && tl.endsWith('|')) {
          tableLines.push(tl)
          i++
        } else break
      }

      const isSep = (r: string) => /^[\|\-\:\s]+$/.test(r)
      const dataRows = tableLines.filter(r => !isSep(r))

      if (dataRows.length >= 2) { // at least header + 1 data row
        const headers = dataRows[0].split('|').filter(c => c.trim()).map(c => c.trim())
        const rows = dataRows.slice(1).map(line => {
          const cells = line.split('|').filter(c => c.trim()).map(c => c.trim())
          const row: Record<string, string> = {}
          headers.forEach((h, idx) => { row[h] = cells[idx] ?? '' })
          return row
        })
        tables.push({ title: lastHeading, headers, rows })
      }
      continue
    }

    i++
  }

  return tables
}

/**
 * Generate a single CSV buffer from one or more table blocks.
 * Prepends a metadata comment line and separates tables with blank lines + section headers.
 */
export function generateCSV(tables: TableBlock[]): Buffer {
  const now = new Date()
  const dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const csvLines: string[] = [`# Social Machine - Gerado em: ${dateStr}`]

  tables.forEach((table, idx) => {
    csvLines.push('') // blank separator
    const sectionLabel = table.title ? `Tabela ${idx + 1}: ${table.title}` : `Tabela ${idx + 1}`
    csvLines.push(`# ${sectionLabel}`)

    // Header row
    csvLines.push(table.headers.map(h => `"${h}"`).join(','))

    // Data rows
    for (const row of table.rows) {
      const values = table.headers.map(h => {
        const val = row[h] ?? ''
        return `"${String(val).replace(/"/g, '""')}"`
      })
      csvLines.push(values.join(','))
    }
  })

  return Buffer.from(csvLines.join('\n'), 'utf-8')
}
