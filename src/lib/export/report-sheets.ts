/**
 * Export data to Google Sheets via Sheets API.
 * Uses the same Google OAuth credentials as Analytics/Search Console.
 */

import { getGoogleAccessToken, isGoogleConfigured } from '@/lib/analytics/google-auth'

/**
 * Create a new Google Sheet with data and return the URL.
 */
export async function createGoogleSheet(options: {
  title: string
  sheets: Array<{
    name: string
    headers: string[]
    rows: Array<Array<string | number>>
  }>
}): Promise<{ ok: boolean; url?: string; spreadsheetId?: string; error?: string }> {
  if (!isGoogleConfigured()) {
    return { ok: false, error: 'Google OAuth nao configurado' }
  }

  const token = await getGoogleAccessToken()

  // 1. Create spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title: options.title },
      sheets: options.sheets.map((s, i) => ({
        properties: { sheetId: i, title: s.name },
      })),
    }),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    return { ok: false, error: `Failed to create sheet: ${err.slice(0, 200)}` }
  }

  const spreadsheet = await createRes.json()
  const spreadsheetId = spreadsheet.spreadsheetId as string

  // 2. Write data to each sheet (prepend metadata row)
  const dateStr = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' })
  const metaRow = [`Social Machine | Gerado em: ${dateStr}`]
  const batchData: Array<{ range: string; values: Array<Array<string | number>> }> = []

  for (const sheet of options.sheets) {
    const values: Array<Array<string | number>> = [metaRow, sheet.headers, ...sheet.rows]
    batchData.push({
      range: `'${sheet.name}'!A1`,
      values,
    })
  }

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: batchData,
      }),
    }
  )

  if (!updateRes.ok) {
    const err = await updateRes.text()
    return { ok: false, error: `Failed to write data: ${err.slice(0, 200)}` }
  }

  // 3. Format: metadata italic (row 0), headers bold (row 1), freeze 2 rows, auto-resize
  const formatRequests = options.sheets.map((sheet, i) => ([
    // Metadata row: italic, gray text
    {
      repeatCell: {
        range: { sheetId: i, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { italic: true, foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } },
          },
        },
        fields: 'userEnteredFormat(textFormat)',
      },
    },
    // Header row: bold + light background
    {
      repeatCell: {
        range: { sheetId: i, startRowIndex: 1, endRowIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    // Freeze metadata + header rows
    {
      updateSheetProperties: {
        properties: { sheetId: i, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Auto-resize all columns
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: i,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: sheet.headers.length || 26,
        },
      },
    },
  ])).flat()

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: formatRequests }),
    }
  )

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
  return { ok: true, url, spreadsheetId }
}

/**
 * Parse markdown tables into sheet-ready data.
 */
export function markdownTablesToSheetData(content: string): Array<{
  name: string
  headers: string[]
  rows: Array<Array<string>>
}> {
  const sheets: Array<{ name: string; headers: string[]; rows: Array<Array<string>> }> = []
  const lines = content.split('\n')

  let currentHeaders: string[] = []
  let currentRows: Array<Array<string>> = []
  let lastHeading: string | null = null
  let inTable = false
  let tableIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Track the most recent heading as potential sheet name
    if (!inTable && trimmed.startsWith('#')) {
      lastHeading = trimmed.replace(/^#+\s*/, '').slice(0, 30)
      continue
    }

    // Detect table headers
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && !inTable) {
      currentHeaders = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())
      currentRows = []
      inTable = true
      continue
    }

    if (inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (/^[|\s:-]+$/.test(trimmed)) continue // Separator
      const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())
      currentRows.push(cells)
      continue
    }

    if (inTable && (!trimmed.startsWith('|') || !trimmed.endsWith('|'))) {
      if (currentHeaders.length > 0 && currentRows.length > 0) {
        tableIndex++
        const name = lastHeading || `Tabela ${tableIndex}`
        sheets.push({ name, headers: currentHeaders, rows: currentRows })
        lastHeading = null // reset so the next table doesn't inherit this heading
      }
      inTable = false
      currentHeaders = []
      currentRows = []
    }
  }

  // Last table
  if (inTable && currentHeaders.length > 0 && currentRows.length > 0) {
    tableIndex++
    const name = lastHeading || `Tabela ${tableIndex}`
    sheets.push({ name, headers: currentHeaders, rows: currentRows })
  }

  return sheets
}
