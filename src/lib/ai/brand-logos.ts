/**
 * Brand logo detection for Brand editorial images.
 *
 * Scans content text for known EV/energy brand names and returns
 * a validated logo URL ready for Satori's <img src> (no redirects).
 *
 * Uses logo.dev CDN — set LOGO_DEV_TOKEN env var (free tier) for
 * higher rate limits: https://logo.dev
 */

// keyword (lowercase, with surrounding spaces for exact match) → domain
const BRAND_MAP: [string, string][] = [
  ['byd',          'byd.com'],
  ['tesla',        'tesla.com'],
  ['rivian',       'rivian.com'],
  ['volkswagen',   'volkswagen.com'],
  [' vw ',         'volkswagen.com'],
  ['bmw',          'bmw.com'],
  ['mercedes',     'mercedes-benz.com'],
  ['hyundai',      'hyundai.com'],
  ['kia',          'kia.com'],
  [' nio ',        'nio.com'],
  ['lucid',        'lucidmotors.com'],
  ['polestar',     'polestar.com'],
  ['ford',         'ford.com'],
  ['chevrolet',    'chevrolet.com'],
  ['chevy',        'chevrolet.com'],
  ['jeep',         'jeep.com'],
  ['fiat',         'fiat.com'],
  ['renault',      'renault.com'],
  ['toyota',       'toyota.com'],
  ['honda',        'honda.com'],
  ['nissan',       'nissan-global.com'],
  ['volvo',        'volvocars.com'],
  ['audi',         'audi.com'],
  ['porsche',      'porsche.com'],
  ['xiaomi',       'xiaomi.com'],
  ['xpeng',        'xpeng.com'],
  ['gwm',          'gwm.com'],
  ['great wall',   'gwm.com'],
  ['stellantis',   'stellantis.com'],
  ['jaguar',       'jaguar.com'],
  ['land rover',   'landrover.com'],
]

const BRAND_DISPLAY_NAME: Record<string, string> = {
  'byd.com':            'BYD',
  'tesla.com':          'Tesla',
  'rivian.com':         'Rivian',
  'volkswagen.com':     'Volkswagen',
  'bmw.com':            'BMW',
  'mercedes-benz.com':  'Mercedes',
  'hyundai.com':        'Hyundai',
  'kia.com':            'Kia',
  'nio.com':            'NIO',
  'lucidmotors.com':    'Lucid',
  'polestar.com':       'Polestar',
  'ford.com':           'Ford',
  'chevrolet.com':      'Chevrolet',
  'jeep.com':           'Jeep',
  'fiat.com':           'Fiat',
  'renault.com':        'Renault',
  'toyota.com':         'Toyota',
  'honda.com':          'Honda',
  'nissan-global.com':  'Nissan',
  'volvocars.com':      'Volvo',
  'audi.com':           'Audi',
  'porsche.com':        'Porsche',
  'xiaomi.com':         'Xiaomi',
  'xpeng.com':          'Xpeng',
  'gwm.com':            'GWM',
  'stellantis.com':     'Stellantis',
  'jaguar.com':         'Jaguar',
  'landrover.com':      'Land Rover',
}

export type BrandLogo = { name: string; logoUrl: string }

/**
 * Pure string scan — no network calls.
 * Returns the first brand match found in the combined texts.
 */
export function detectBrand(texts: string[]): { name: string; domain: string } | null {
  const combined = ' ' + texts.filter(Boolean).join(' ').toLowerCase() + ' '
  for (const [keyword, domain] of BRAND_MAP) {
    // Use includes with padded keyword for word-boundary-like matching
    const padded = keyword.startsWith(' ') ? keyword : ` ${keyword} `
    if (combined.includes(padded)) {
      return { name: BRAND_DISPLAY_NAME[domain] ?? keyword.trim(), domain }
    }
  }
  return null
}

function buildLogoUrl(domain: string): string {
  const token = process.env.LOGO_DEV_TOKEN
  const base = `https://img.logo.dev/${domain}?format=png&size=64`
  return token ? `${base}&token=${token}` : base
}

/**
 * Validates the logo URL returns an actual image.
 * Returns null on any failure — badge is cosmetic, never blocks image generation.
 */
export async function resolveLogoUrl(domain: string): Promise<BrandLogo | null> {
  const url = buildLogoUrl(domain)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.startsWith('image/')) return null
    return { name: BRAND_DISPLAY_NAME[domain] ?? domain, logoUrl: url }
  } catch {
    return null
  }
}
