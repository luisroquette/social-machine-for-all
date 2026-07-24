/**
 * Generate a professional PDF report using pdf-lib.
 * Pure JS — works on Vercel serverless with zero native dependencies.
 */

import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib'

interface Section {
  type: 'h1' | 'h2' | 'h3' | 'text' | 'bullet' | 'divider' | 'space' | 'table'
  content: string
  tableData?: { headers: string[]; rows: string[][] }
}

function parseTableRow(row: string): string[] {
  return row.split('|').filter(c => c.trim() !== '').map(c => c.trim())
}

function isSeparatorRow(row: string): boolean {
  return /^[\|\-\:\s]+$/.test(row)
}

function parseMarkdown(content: string): Section[] {
  const sections: Section[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const t = lines[i].trim()

    if (!t) { sections.push({ type: 'space', content: '' }); i++; continue }
    if (t.startsWith('### ')) { sections.push({ type: 'h3', content: t.slice(4) }); i++; continue }
    if (t.startsWith('## ')) { sections.push({ type: 'h2', content: t.slice(3) }); i++; continue }
    if (t.startsWith('# ')) { sections.push({ type: 'h1', content: t.slice(2) }); i++; continue }
    if (t.startsWith('---')) { sections.push({ type: 'divider', content: '' }); i++; continue }
    if (t.startsWith('- ') || t.startsWith('• ') || /^\d+\.\s/.test(t)) {
      sections.push({ type: 'bullet', content: t.replace(/^[-•]\s/, '').replace(/^\d+\.\s/, '') })
      i++; continue
    }

    // Table: collect all consecutive table rows
    if (t.startsWith('|') && t.endsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length) {
        const tl = lines[i].trim()
        if (tl.startsWith('|') && tl.endsWith('|')) { tableLines.push(tl); i++ }
        else break
      }
      const dataRows = tableLines.filter(r => !isSeparatorRow(r))
      if (dataRows.length >= 1) {
        const headers = parseTableRow(dataRows[0])
        const rows = dataRows.slice(1).map(parseTableRow)
        sections.push({ type: 'table', content: '', tableData: { headers, rows } })
      }
      continue
    }

    sections.push({ type: 'text', content: t })
    i++
  }
  return sections
}

function cleanText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove emojis and non-latin1 chars that standard PDF fonts can't render
    .replace(/[^\x00-\xFF]/g, '')
    .trim()
}

/** Wrap text to fit within maxWidth (in points), returns array of lines */
function wrapText(text: string, font: import('pdf-lib').PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    const width = font.widthOfTextAtSize(test, fontSize)
    if (width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

export async function generateReportPDF(options: {
  title: string
  content: string
  date?: string
}): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique)

  const [pageWidth, pageHeight] = PageSizes.A4 // 595.28 x 841.89 pts
  const margin = 50
  const contentWidth = pageWidth - margin * 2
  const date = options.date ?? new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' })

  let page = doc.addPage(PageSizes.A4)
  let y = pageHeight - margin

  function newPage() {
    page = doc.addPage(PageSizes.A4)
    y = pageHeight - margin
  }

  function checkPage(needed: number) {
    if (y - needed < margin + 30) newPage()
  }

  // ── Header band ──
  page.drawRectangle({
    x: 0, y: pageHeight - 60,
    width: pageWidth, height: 60,
    color: rgb(0.08, 0.08, 0.08),
  })
  const titleText = cleanText(options.title).slice(0, 60)
  page.drawText(titleText, {
    x: margin, y: pageHeight - 28,
    size: 16, font: fontBold, color: rgb(1, 1, 1),
  })
  page.drawText(date, {
    x: margin, y: pageHeight - 46,
    size: 9, font: fontRegular, color: rgb(0.7, 0.7, 0.7),
  })
  const byline = 'Social Machine V3 - Editor-Chefe'
  const bylineWidth = fontRegular.widthOfTextAtSize(byline, 9)
  page.drawText(byline, {
    x: pageWidth - margin - bylineWidth, y: pageHeight - 46,
    size: 9, font: fontRegular, color: rgb(0.7, 0.7, 0.7),
  })

  y = pageHeight - 80

  const sections = parseMarkdown(options.content)

  for (const section of sections) {
    const text = cleanText(section.content)

    switch (section.type) {
      case 'h1': {
        checkPage(24)
        y -= 6
        page.drawRectangle({
          x: margin - 4, y: y - 4,
          width: contentWidth + 8, height: 20,
          color: rgb(0.95, 0.95, 0.95),
        })
        page.drawText(text.slice(0, 70), {
          x: margin, y: y + 4,
          size: 14, font: fontBold, color: rgb(0.08, 0.08, 0.08),
        })
        y -= 22
        break
      }
      case 'h2': {
        checkPage(20)
        y -= 8
        page.drawText(text.slice(0, 70), {
          x: margin, y,
          size: 12, font: fontBold, color: rgb(0.2, 0.2, 0.2),
        })
        y -= 6
        page.drawLine({
          start: { x: margin, y }, end: { x: margin + contentWidth, y },
          thickness: 0.5, color: rgb(0.75, 0.75, 0.75),
        })
        y -= 8
        break
      }
      case 'h3': {
        checkPage(14)
        y -= 4
        page.drawText(text.slice(0, 80), {
          x: margin, y,
          size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3),
        })
        y -= 14
        break
      }
      case 'bullet': {
        const lines = wrapText(text, fontRegular, 10, contentWidth - 14)
        checkPage(lines.length * 13 + 2)
        page.drawText('•', { x: margin + 4, y, size: 10, font: fontBold, color: rgb(0.4, 0.4, 0.4) })
        for (const ln of lines) {
          checkPage(13)
          page.drawText(ln, { x: margin + 14, y, size: 10, font: fontRegular, color: rgb(0.2, 0.2, 0.2) })
          y -= 13
        }
        break
      }
      case 'text': {
        if (!text) break
        const lines = wrapText(text, fontRegular, 10, contentWidth)
        checkPage(lines.length * 13)
        for (const ln of lines) {
          checkPage(13)
          page.drawText(ln, { x: margin, y, size: 10, font: fontRegular, color: rgb(0.2, 0.2, 0.2) })
          y -= 13
        }
        break
      }
      case 'divider': {
        checkPage(10)
        y -= 4
        page.drawLine({
          start: { x: margin, y }, end: { x: margin + contentWidth, y },
          thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
        })
        y -= 8
        break
      }
      case 'table': {
        if (!section.tableData) break
        const { headers, rows } = section.tableData
        const nCols = headers.length
        if (nCols === 0) break

        const colWidth = contentWidth / nCols
        const cellPadX = 6
        const cellPadY = 4
        const tFontSize = 9
        const rowHeight = tFontSize + cellPadY * 2 + 2

        // Top border of entire table
        const tableTopY = y - 4

        // Header row
        checkPage(rowHeight * 2 + 8)
        page.drawRectangle({
          x: margin, y: tableTopY - rowHeight,
          width: contentWidth, height: rowHeight,
          color: rgb(0.88, 0.88, 0.88),
        })
        for (let ci = 0; ci < nCols; ci++) {
          const maxChars = Math.max(4, Math.floor(colWidth / (tFontSize * 0.55)))
          const cellText = cleanText(headers[ci]).slice(0, maxChars)
          page.drawText(cellText, {
            x: margin + ci * colWidth + cellPadX,
            y: tableTopY - rowHeight + cellPadY + 2,
            size: tFontSize, font: fontBold, color: rgb(0.1, 0.1, 0.1),
          })
        }
        // Header bottom line
        page.drawLine({
          start: { x: margin, y: tableTopY - rowHeight },
          end: { x: margin + contentWidth, y: tableTopY - rowHeight },
          thickness: 0.7, color: rgb(0.55, 0.55, 0.55),
        })
        y = tableTopY - rowHeight

        // Data rows
        for (const row of rows) {
          checkPage(rowHeight)
          for (let ci = 0; ci < nCols; ci++) {
            const maxChars = Math.max(4, Math.floor(colWidth / (tFontSize * 0.55)))
            const cellText = cleanText(row[ci] ?? '').slice(0, maxChars)
            page.drawText(cellText, {
              x: margin + ci * colWidth + cellPadX,
              y: y - rowHeight + cellPadY + 2,
              size: tFontSize, font: fontRegular, color: rgb(0.2, 0.2, 0.2),
            })
          }
          page.drawLine({
            start: { x: margin, y: y - rowHeight },
            end: { x: margin + contentWidth, y: y - rowHeight },
            thickness: 0.3, color: rgb(0.8, 0.8, 0.8),
          })
          y -= rowHeight
        }

        // Vertical column dividers (drawn over all rows)
        for (let ci = 1; ci < nCols; ci++) {
          page.drawLine({
            start: { x: margin + ci * colWidth, y: tableTopY },
            end: { x: margin + ci * colWidth, y },
            thickness: 0.4, color: rgb(0.72, 0.72, 0.72),
          })
        }
        // Outer box (stroke only, no fill)
        page.drawRectangle({
          x: margin, y,
          width: contentWidth, height: tableTopY - y,
          borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.6,
        })
        y -= 8
        break
      }
      case 'space': {
        y -= 5
        break
      }
    }
  }

  // ── Footer ──
  checkPage(25)
  y = Math.min(y - 10, margin + 20)
  page.drawLine({
    start: { x: margin, y: margin + 18 }, end: { x: margin + contentWidth, y: margin + 18 },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  })
  const footerText = `Gerado automaticamente por Social Machine V3 - Editor-Chefe | ${date}`
  const footerWidth = fontOblique.widthOfTextAtSize(footerText, 8)
  page.drawText(footerText, {
    x: (pageWidth - footerWidth) / 2, y: margin + 6,
    size: 8, font: fontOblique, color: rgb(0.6, 0.6, 0.6),
  })

  const pdfBytes = await doc.save()
  return Buffer.from(pdfBytes)
}
