import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkServerCertificate, parsePkcs12, P12Error } from '../src/pkcs12.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.p12`, import.meta.url));
const HOST = 'portal.firma.de';
const NOW = new Date('2026-12-01T12:00:00Z'); // feste Zeit: Testzertifikate bleiben "gültig"
const check = (n: string, pw: string) => checkServerCertificate(parsePkcs12(fx(n), pw), HOST, NOW);

describe('PKCS#12 einlesen', () => {
  it('OpenSSL-3-Standard (AES-256, ECDSA) mit Kette', () => {
    const r = check('ec-aes', 'Geheim123!');
    expect(r.ok).toBe(true);
    expect(r.info?.key).toBe('ECDSA P-384');
    expect(r.info?.chain).toHaveLength(1);
    expect(r.warnings).toEqual([]);
    expect(r.certPem.match(/BEGIN CERTIFICATE/g)).toHaveLength(2); // Server + Zwischenzertifikat, ohne Wurzel
    expect(r.keyPem).toContain('BEGIN PRIVATE KEY');
  });
  it('Alt-Format 3DES/SHA-1 und leeres Passwort', () => {
    expect(check('rsa-3des', 'Geheim123!').ok).toBe(true);
    expect(check('rsa-nopass', '').info?.key).toBe('RSA 3072 bit');
  });
  it('ohne MAC und ohne Kette (Warnung)', () => {
    expect(check('nomac', 'x').ok).toBe(true);
    const r = check('ec-nochain', 'x');
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toContain('Zwischenzertifikate');
  });
  it('falsches Passwort', () => {
    expect(() => parsePkcs12(fx('ec-aes'), 'falsch')).toThrow(/Passwort/);
    expect(() => parsePkcs12(fx('rsa-3des'), 'falsch')).toThrow(P12Error);
  });
  it('RC2 wird mit Hinweis abgelehnt', () => {
    try { parsePkcs12(fx('rsa-rc2'), 'x'); expect.unreachable(); } catch (e) {
      expect((e as P12Error).code).toBe('p12_legacy');
    }
  });
  it('falscher Hostname und abgelaufen', () => {
    expect(check('wronghost', 'x').errors.join()).toContain('portal.firma.de');
    const late = checkServerCertificate(parsePkcs12(fx('ec-aes'), 'Geheim123!'), HOST, new Date('2035-01-01'));
    expect(late.ok).toBe(false);
    expect(late.keyPem).toBe('');
  });
  it('selbstsigniert: erlaubt, aber mit Warnung', () => {
    const r = check('selfsigned', 'x');
    expect(r.ok).toBe(true);
    expect(r.info?.selfSigned).toBe(true);
    expect(r.warnings.join()).toContain('Selbstsigniert');
  });
  it('beliebige/kaputte Eingaben werfen nur P12Error', () => {
    const good = fx('nomac');
    for (let i = 0; i < 500; i++) {
      const b = i % 2 ? randomBytes(1 + i) : Buffer.from(good.subarray(0, 1 + ((i * 37) % good.length)));
      try { parsePkcs12(b, 'x'); } catch (e) { expect(e).toBeInstanceOf(P12Error); }
    }
    expect(() => parsePkcs12(Buffer.alloc(70_000), 'x')).toThrow(/zu groß/);
  });
});
