/**
 * PKCS#12 (.p12/.pfx) einlesen und als TLS-Serverzertifikat prüfen – ohne Fremdbibliothek.
 *
 * Unterstützt (RFC 7292, RFC 8018):
 *  - Integrität: HMAC mit PKCS#12-KDF (SHA-1, SHA-224/256/384/512)
 *  - Verschlüsselung: PBES2 (PBKDF2 + AES-128/192/256-CBC oder 3DES) – Standard von OpenSSL 3 und Windows (AES-256)
 *                     pbeWithSHAAnd3-KeyTripleDES-CBC (ältere Exporte)
 *  - Taschen: keyBag, pkcs8ShroudedKeyBag, certBag (X.509), safeContentsBag
 * Nicht unterstützt: RC2/RC4 (unsicher, in OpenSSL 3 nur im Legacy-Provider), PBMAC1, Public-Key-Modus.
 *
 * Eingaben sind nicht vertrauenswürdig: Größe, Schachtelungstiefe, Knotenzahl und Iterationen sind begrenzt.
 */
import {
  createDecipheriv, createHash, createHmac, createPrivateKey, KeyObject, pbkdf2Sync, timingSafeEqual, X509Certificate,
} from 'node:crypto';

export class P12Error extends Error {
  readonly code: string;
  constructor(message: string, code = 'p12_invalid') { super(message); this.code = code; }
}

const MAX_INPUT = 64 * 1024;
const MAX_DEPTH = 24;
const MAX_NODES = 20_000;
const MAX_PBKDF2_ITER = 2_000_000;
const MAX_P12KDF_ITER = 600_000;

// ------------------------------------------------------------------ DER/BER
interface Node { tag: number; constructed: boolean; cls: number; num: number; value: Buffer; children: Node[] }

function parseDer(buf: Buffer): Node {
  let nodes = 0;
  const read = (pos: number, end: number, depth: number): { node: Node; next: number } => {
    if (depth > MAX_DEPTH) throw new P12Error('Datei zu tief verschachtelt');
    if (++nodes > MAX_NODES) throw new P12Error('Datei enthält zu viele Elemente');
    if (pos + 2 > end) throw new P12Error('Datei abgeschnitten');
    const tag = buf[pos]!;
    if ((tag & 0x1f) === 0x1f) throw new P12Error('Nicht unterstütztes ASN.1-Tag');
    let p = pos + 1;
    let len = buf[p++]!;
    let indefinite = false;
    if (len === 0x80) indefinite = true;
    else if (len & 0x80) {
      const n = len & 0x7f;
      if (n > 4 || p + n > end) throw new P12Error('Ungültige Länge');
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf[p++]!;
    }
    const constructed = (tag & 0x20) !== 0;
    const node: Node = { tag, constructed, cls: tag >> 6, num: tag & 0x1f, value: Buffer.alloc(0), children: [] };
    if (indefinite) {
      if (!constructed) throw new P12Error('Ungültige BER-Kodierung');
      let q = p;
      for (;;) {
        if (q + 2 > end) throw new P12Error('Datei abgeschnitten');
        if (buf[q] === 0 && buf[q + 1] === 0) { q += 2; break; }
        const r = read(q, end, depth + 1);
        node.children.push(r.node);
        q = r.next;
      }
      return { node, next: q };
    }
    if (p + len > end) throw new P12Error('Datei abgeschnitten');
    node.value = buf.subarray(p, p + len);
    if (constructed) {
      let q = p;
      while (q < p + len) {
        const r = read(q, p + len, depth + 1);
        node.children.push(r.node);
        q = r.next;
      }
    }
    return { node, next: p + len };
  };
  const { node, next } = read(0, buf.length, 0);
  if (next !== buf.length) throw new P12Error('Unerwartete Daten am Dateiende');
  return node;
}

const SEQ = 0x30, OCTETS = 0x04, OID = 0x06, INT = 0x02;
function expect(n: Node | undefined, tag: number, what: string): Node {
  if (!n || (n.tag !== tag && n.tag !== (tag | 0x20))) throw new P12Error(`Ungültige Struktur (${what})`);
  return n;
}
/** OCTET STRING – auch BER-konstruiert (zusammengesetzt) */
function octets(n: Node): Buffer {
  if ((n.tag & 0x1f) !== 0x04 && n.tag !== 0x80 && n.tag !== 0xa0) throw new P12Error('OCTET STRING erwartet');
  return n.constructed ? Buffer.concat(n.children.map(octets)) : n.value;
}
function oid(n: Node | undefined): string {
  const v = expect(n, OID, 'OID').value;
  if (v.length === 0 || v.length > 64) throw new P12Error('Ungültige OID');
  const parts = [Math.floor(v[0]! / 40), v[0]! % 40];
  let acc = 0;
  for (let i = 1; i < v.length; i++) {
    acc = acc * 128 + (v[i]! & 0x7f);
    if (!(v[i]! & 0x80)) { parts.push(acc); acc = 0; }
  }
  return parts.join('.');
}
function int(n: Node | undefined): number {
  const v = expect(n, INT, 'INTEGER').value;
  if (v.length === 0 || v.length > 6) throw new P12Error('Ungültiger Zahlenwert');
  let x = 0;
  for (const b of v) x = x * 256 + b;
  return x;
}
/** [0] EXPLICIT → innerer Knoten */
function explicit0(n: Node | undefined): Node {
  if (!n || n.tag !== 0xa0 || n.children.length !== 1) throw new P12Error('Ungültige Struktur ([0])');
  return n.children[0]!;
}
const der = (n: Node): Buffer => encodeDer(n);
function encodeDer(n: Node): Buffer {
  const body = n.constructed ? Buffer.concat(n.children.map(encodeDer)) : n.value;
  const len = body.length;
  let hdr: Buffer;
  if (len < 0x80) hdr = Buffer.from([n.tag, len]);
  else {
    const bytes: number[] = [];
    for (let l = len; l > 0; l = Math.floor(l / 256)) bytes.unshift(l & 0xff);
    hdr = Buffer.from([n.tag, 0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([hdr, body]);
}

// ------------------------------------------------------------------ OIDs
const O = {
  data: '1.2.840.113549.1.7.1',
  encryptedData: '1.2.840.113549.1.7.6',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  safeContentsBag: '1.2.840.113549.1.12.10.1.6',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
  pbmac1: '1.2.840.113549.1.5.14',
  sha3DES: '1.2.840.113549.1.12.1.3',
  sha2DES: '1.2.840.113549.1.12.1.4',
  rc2_128: '1.2.840.113549.1.12.1.5',
  rc2_40: '1.2.840.113549.1.12.1.6',
  rc4_128: '1.2.840.113549.1.12.1.1',
  rc4_40: '1.2.840.113549.1.12.1.2',
};
const HASH: Record<string, { name: string; v: number }> = {
  '1.3.14.3.2.26': { name: 'sha1', v: 64 },
  '2.16.840.1.101.3.4.2.4': { name: 'sha224', v: 64 },
  '2.16.840.1.101.3.4.2.1': { name: 'sha256', v: 64 },
  '2.16.840.1.101.3.4.2.2': { name: 'sha384', v: 128 },
  '2.16.840.1.101.3.4.2.3': { name: 'sha512', v: 128 },
};
const HMAC_PRF: Record<string, string> = {
  '1.2.840.113549.2.7': 'sha1', '1.2.840.113549.2.8': 'sha224', '1.2.840.113549.2.9': 'sha256',
  '1.2.840.113549.2.10': 'sha384', '1.2.840.113549.2.11': 'sha512',
};
const CIPHER: Record<string, { name: string; key: number }> = {
  '2.16.840.1.101.3.4.1.2': { name: 'aes-128-cbc', key: 16 },
  '2.16.840.1.101.3.4.1.22': { name: 'aes-192-cbc', key: 24 },
  '2.16.840.1.101.3.4.1.42': { name: 'aes-256-cbc', key: 32 },
  '1.2.840.113549.3.7': { name: 'des-ede3-cbc', key: 24 },
};

// ------------------------------------------------------------------ Kryptografie
/** BMPString (UTF-16BE) mit abschließendem Nullzeichen – Passwortformat der PKCS#12-KDF */
function bmpPassword(pw: string): Buffer {
  const b = Buffer.alloc((pw.length + 1) * 2);
  for (let i = 0; i < pw.length; i++) b.writeUInt16BE(pw.charCodeAt(i), i * 2);
  return b;
}

/** RFC 7292, Anhang B.2 */
function p12kdf(pass: Buffer, salt: Buffer, id: number, iter: number, n: number, hashName: string, v: number): Buffer {
  if (iter < 1 || iter > MAX_P12KDF_ITER) throw new P12Error('Iterationszahl außerhalb des zulässigen Bereichs');
  const u = createHash(hashName).digest().length;
  const D = Buffer.alloc(v, id);
  const fill = (src: Buffer) => {
    if (src.length === 0) return Buffer.alloc(0);
    const out = Buffer.alloc(v * Math.ceil(src.length / v));
    for (let i = 0; i < out.length; i++) out[i] = src[i % src.length]!;
    return out;
  };
  const I = Buffer.concat([fill(salt), fill(pass)]);
  const out: Buffer[] = [];
  for (let produced = 0; produced < n; produced += u) {
    let A = createHash(hashName).update(D).update(I).digest();
    for (let r = 1; r < iter; r++) A = createHash(hashName).update(A).digest();
    out.push(A);
    const B = Buffer.alloc(v);
    for (let i = 0; i < v; i++) B[i] = A[i % u]!;
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const s = I[j + k]! + B[k]! + carry;
        I[j + k] = s & 0xff;
        carry = s >> 8;
      }
    }
  }
  return Buffer.concat(out).subarray(0, n);
}

function decrypt(algNode: Node, data: Buffer, password: string): Buffer {
  const alg = expect(algNode, SEQ, 'Algorithmus');
  const algOid = oid(alg.children[0]);
  const params = alg.children[1];
  try {
    if (algOid === O.pbes2) {
      const p = expect(params, SEQ, 'PBES2');
      const kdf = expect(p.children[0], SEQ, 'KDF');
      const enc = expect(p.children[1], SEQ, 'Verschlüsselung');
      if (oid(kdf.children[0]) !== O.pbkdf2) throw new P12Error('Nur PBKDF2 wird unterstützt');
      const kp = expect(kdf.children[1], SEQ, 'PBKDF2');
      const salt = expect(kp.children[0], OCTETS, 'Salt').value;
      const iter = int(kp.children[1]);
      if (iter < 1 || iter > MAX_PBKDF2_ITER) throw new P12Error('Iterationszahl außerhalb des zulässigen Bereichs');
      let prf = 'sha1';
      for (const c of kp.children.slice(2)) if (c.tag === SEQ) prf = HMAC_PRF[oid(c.children[0])] ?? '';
      if (!prf) throw new P12Error('Nicht unterstützte PBKDF2-Hashfunktion');
      const cipher = CIPHER[oid(enc.children[0])];
      if (!cipher) throw new P12Error('Nicht unterstütztes Verschlüsselungsverfahren');
      const iv = expect(enc.children[1], OCTETS, 'IV').value;
      const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iter, cipher.key, prf);
      const d = createDecipheriv(cipher.name, key, iv);
      return Buffer.concat([d.update(data), d.final()]);
    }
    if (algOid === O.sha3DES) {
      const p = expect(params, SEQ, 'PBE');
      const salt = expect(p.children[0], OCTETS, 'Salt').value;
      const iter = int(p.children[1]);
      const pw = bmpPassword(password);
      const key = p12kdf(pw, salt, 1, iter, 24, 'sha1', 64);
      const iv = p12kdf(pw, salt, 2, iter, 8, 'sha1', 64);
      const d = createDecipheriv('des-ede3-cbc', key, iv);
      return Buffer.concat([d.update(data), d.final()]);
    }
  } catch (e) {
    if (e instanceof P12Error) throw e;
    throw new P12Error('Entschlüsselung fehlgeschlagen – Passwort falsch?', 'p12_password');
  }
  if ([O.rc2_40, O.rc2_128, O.rc4_40, O.rc4_128, O.sha2DES].includes(algOid)) {
    throw new P12Error('Veraltete Verschlüsselung (RC2/RC4). Bitte mit AES exportieren, z. B. '
      + '„openssl pkcs12 -export -certpbe AES-256-CBC -keypbe AES-256-CBC -macalg sha256 …“ '
      + 'oder unter Windows „AES256-SHA256“ wählen.', 'p12_legacy');
  }
  throw new P12Error(`Nicht unterstütztes Verschlüsselungsverfahren (${algOid})`);
}

function verifyMac(macData: Node, authSafe: Buffer, password: string): void {
  const md = expect(macData, SEQ, 'MAC');
  const digestInfo = expect(md.children[0], SEQ, 'MAC-Digest');
  const algId = expect(digestInfo.children[0], SEQ, 'MAC-Algorithmus');
  const algOid = oid(algId.children[0]);
  if (algOid === O.pbmac1) throw new P12Error('PBMAC1 wird nicht unterstützt – bitte mit „-macalg sha256“ exportieren', 'p12_legacy');
  const h = HASH[algOid];
  if (!h) throw new P12Error('Nicht unterstütztes MAC-Verfahren');
  const expected = expect(digestInfo.children[1], OCTETS, 'MAC-Wert').value;
  const salt = expect(md.children[1], OCTETS, 'MAC-Salt').value;
  const iter = md.children[2] ? int(md.children[2]) : 1;
  const len = createHash(h.name).digest().length;
  // Leeres Passwort: je nach Werkzeug als leerer BMPString (nur 0x0000) oder ganz ohne Bytes kodiert
  const candidates = password === '' ? [bmpPassword(''), Buffer.alloc(0)] : [bmpPassword(password)];
  for (const pw of candidates) {
    const key = p12kdf(pw, salt, 3, iter, len, h.name, h.v);
    const mac = createHmac(h.name, key).update(authSafe).digest();
    if (mac.length === expected.length && timingSafeEqual(mac, expected)) return;
  }
  throw new P12Error('Passwort falsch oder Datei beschädigt (Integritätsprüfung fehlgeschlagen)', 'p12_password');
}

// ------------------------------------------------------------------ PKCS#12
export interface P12Contents { keys: KeyObject[]; certs: X509Certificate[] }

export function parsePkcs12(input: Buffer, password: string): P12Contents {
  try { return parseInner(input, password); } catch (e) {
    if (e instanceof P12Error) throw e;
    throw new P12Error('Keine gültige PKCS#12-Datei');
  }
}

function parseInner(input: Buffer, password: string): P12Contents {
  if (input.length === 0) throw new P12Error('Datei ist leer');
  if (input.length > MAX_INPUT) throw new P12Error('Datei ist zu groß (max. 64 KB)');
  if (password.length > 256) throw new P12Error('Passwort zu lang');
  let pfx: Node;
  try { pfx = parseDer(input); } catch (e) {
    if (e instanceof P12Error) throw new P12Error(`Keine gültige PKCS#12-Datei: ${e.message}`);
    throw new P12Error('Keine gültige PKCS#12-Datei');
  }
  expect(pfx, SEQ, 'PFX');
  if (int(pfx.children[0]) !== 3) throw new P12Error('Nicht unterstützte PKCS#12-Version');
  const authSafeCI = expect(pfx.children[1], SEQ, 'authSafe');
  if (oid(authSafeCI.children[0]) !== O.data) throw new P12Error('Nur passwortgeschützte PKCS#12-Dateien werden unterstützt');
  const authSafeBytes = octets(explicit0(authSafeCI.children[1]));
  if (pfx.children[2]) verifyMac(pfx.children[2], authSafeBytes, password);

  const out: P12Contents = { keys: [], certs: [] };
  const handleBags = (safeContents: Buffer, depth: number) => {
    if (depth > 3) throw new P12Error('Zu tief verschachtelte Taschen');
    const bags = expect(parseDer(safeContents), SEQ, 'SafeContents');
    for (const bag of bags.children) {
      expect(bag, SEQ, 'SafeBag');
      const type = oid(bag.children[0]);
      const val = explicit0(bag.children[1]);
      if (type === O.keyBag) {
        try { out.keys.push(createPrivateKey({ key: der(val), format: 'der', type: 'pkcs8' })); } catch {
          throw new P12Error('Privater Schlüssel konnte nicht gelesen werden');
        }
      } else if (type === O.shroudedKeyBag) {
        const epki = expect(val, SEQ, 'EncryptedPrivateKeyInfo');
        const plain = decrypt(epki.children[0]!, octets(expect(epki.children[1], OCTETS, 'Schlüsseldaten')), password);
        try { out.keys.push(createPrivateKey({ key: plain, format: 'der', type: 'pkcs8' })); } catch {
          throw new P12Error('Privater Schlüssel konnte nicht gelesen werden', 'p12_password');
        }
      } else if (type === O.certBag) {
        const cb = expect(val, SEQ, 'CertBag');
        if (oid(cb.children[0]) !== O.x509Certificate) continue;
        try { out.certs.push(new X509Certificate(octets(explicit0(cb.children[1])))); } catch {
          throw new P12Error('Zertifikat in der Datei ist beschädigt');
        }
      } else if (type === O.safeContentsBag) {
        handleBags(der(val), depth + 1);
      }
      // CRL-/Secret-Taschen werden ignoriert
    }
  };

  const contents = expect(parseDer(authSafeBytes), SEQ, 'AuthenticatedSafe');
  for (const ci of contents.children) {
    expect(ci, SEQ, 'ContentInfo');
    const ct = oid(ci.children[0]);
    if (ct === O.data) {
      handleBags(octets(explicit0(ci.children[1])), 0);
    } else if (ct === O.encryptedData) {
      const ed = expect(explicit0(ci.children[1]), SEQ, 'EncryptedData');
      const eci = expect(ed.children[1], SEQ, 'EncryptedContentInfo');
      const encContent = eci.children[2];
      if (!encContent) continue; // leer
      handleBags(decrypt(eci.children[1]!, octets(encContent), password), 0);
    } else {
      throw new P12Error('Nicht unterstützter Inhaltstyp (z. B. Public-Key-Verschlüsselung)');
    }
  }
  return out;
}

// ------------------------------------------------------------------ Prüfung als TLS-Serverzertifikat
export interface CertInfo {
  subject: string;
  issuer: string;
  subjectAltName: string | null;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  fingerprint256: string;
  key: string;
  selfSigned: boolean;
  chain: { subject: string; issuer: string; validTo: string }[];
}
export interface ServerCertCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: CertInfo | null;
  certPem: string;
  keyPem: string;
}

const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const ANY_EKU = '2.5.29.37.0';
const ALLOWED_CURVES = new Set(['prime256v1', 'secp384r1', 'secp521r1']);

function keyDescription(k: KeyObject): { text: string; error?: string; warning?: string } {
  const d = k.asymmetricKeyDetails ?? {};
  if (k.asymmetricKeyType === 'rsa') {
    const bits = d.modulusLength ?? 0;
    if (bits < 2048) return { text: `RSA ${bits} bit`, error: `RSA-Schlüssel mit ${bits} bit ist zu schwach (mindestens 2048, empfohlen ≥ 3072)` };
    return { text: `RSA ${bits} bit`, warning: bits < 3072 ? `RSA ${bits} bit – BSI TR-02102 empfiehlt ≥ 3072 bit` : undefined };
  }
  if (k.asymmetricKeyType === 'ec') {
    const curve = d.namedCurve ?? '?';
    if (!ALLOWED_CURVES.has(curve)) return { text: `EC ${curve}`, error: `Elliptische Kurve ${curve} wird nicht unterstützt (P-256, P-384, P-521)` };
    return { text: `ECDSA ${curve === 'prime256v1' ? 'P-256' : curve === 'secp384r1' ? 'P-384' : 'P-521'}` };
  }
  return { text: String(k.asymmetricKeyType), error: `Schlüsseltyp ${k.asymmetricKeyType} wird für TLS-Serverzertifikate nicht unterstützt` };
}

/**
 * Kette ab dem Serverzertifikat; selbstsignierte Wurzeln werden nicht mit ausgeliefert
 * (sie liegen im Vertrauensspeicher der Clients). "complete" = mindestens ein Zwischenzertifikat
 * oder direkt von einer mitgelieferten Wurzel ausgestellt.
 */
function buildChain(leaf: X509Certificate, pool: X509Certificate[]): { chain: X509Certificate[]; complete: boolean } {
  const chain = [leaf];
  let cur = leaf;
  for (let i = 0; i < 8; i++) {
    if (cur.checkIssued(cur)) return { chain, complete: true };
    const parent = pool.find((c) => c !== cur && !chain.includes(c) && cur.checkIssued(c) && cur.verify(c.publicKey));
    if (!parent) return { chain, complete: chain.length > 1 };
    if (parent.checkIssued(parent)) return { chain, complete: true }; // Wurzel nicht mitsenden
    chain.push(parent);
    cur = parent;
  }
  return { chain, complete: chain.length > 1 };
}

export function checkServerCertificate(contents: P12Contents, hostname: string, now = new Date()): ServerCertCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (e: string): ServerCertCheck => ({ ok: false, errors: [...errors, e], warnings, info: null, certPem: '', keyPem: '' });

  if (contents.keys.length === 0) return fail('Die Datei enthält keinen privaten Schlüssel.');
  if (contents.certs.length === 0) return fail('Die Datei enthält kein Zertifikat.');
  let key: KeyObject | undefined;
  let leaf: X509Certificate | undefined;
  // bevorzugt Nicht-CA-Zertifikate; selbstsignierte Testzertifikate tragen oft CA:TRUE
  for (const k of contents.keys) {
    const c = contents.certs.find((x) => !x.ca && x.checkPrivateKey(k)) ?? contents.certs.find((x) => x.checkPrivateKey(k));
    if (c) { key = k; leaf = c; break; }
  }
  if (!key || !leaf) return fail('Kein Zertifikat in der Datei passt zum privaten Schlüssel.');

  const kd = keyDescription(key);
  if (kd.error) errors.push(kd.error);
  if (kd.warning) warnings.push(kd.warning);

  const from = new Date(leaf.validFrom);
  const to = new Date(leaf.validTo);
  const days = Math.floor((to.getTime() - now.getTime()) / 86_400_000);
  if (now < from) errors.push(`Zertifikat ist erst ab ${from.toLocaleDateString('de-DE')} gültig.`);
  if (now > to) errors.push(`Zertifikat ist am ${to.toLocaleDateString('de-DE')} abgelaufen.`);
  else if (days < 30) warnings.push(`Zertifikat läuft in ${days} Tagen ab.`);

  if (!leaf.checkHost(hostname)) errors.push(`Zertifikat gilt nicht für den Portal-Hostnamen „${hostname}“.`);
  const eku = leaf.keyUsage; // erweiterte Schlüsselverwendung (OIDs)
  if (eku && eku.length > 0 && !eku.includes(SERVER_AUTH) && !eku.includes(ANY_EKU)) {
    errors.push('Zertifikat ist nicht für TLS-Server (Extended Key Usage „serverAuth“) ausgestellt.');
  }

  const selfSigned = leaf.checkIssued(leaf);
  if (selfSigned) warnings.push('Selbstsigniertes Zertifikat – Browser zeigen eine Warnung. Für den Produktivbetrieb ein Zertifikat der Unternehmens-PKI verwenden.');
  const { chain, complete } = buildChain(leaf, contents.certs);
  if (!selfSigned && !complete) warnings.push('Die Datei enthält keine Zwischenzertifikate – manche Clients können die Kette dann nicht prüfen. Beim Export „Alle Zertifikate im Zertifizierungspfad einbeziehen“ wählen.');

  const info: CertInfo = {
    subject: leaf.subject.replace(/\n/g, ', '),
    issuer: leaf.issuer.replace(/\n/g, ', '),
    subjectAltName: leaf.subjectAltName ?? null,
    serialNumber: leaf.serialNumber,
    validFrom: from.toISOString(),
    validTo: to.toISOString(),
    daysRemaining: days,
    fingerprint256: leaf.fingerprint256,
    key: kd.text,
    selfSigned,
    chain: chain.slice(1).map((c) => ({ subject: c.subject.replace(/\n/g, ', '), issuer: c.issuer.replace(/\n/g, ', '), validTo: new Date(c.validTo).toISOString() })),
  };
  const ok = errors.length === 0;
  return {
    ok, errors, warnings, info,
    certPem: ok ? chain.map((c) => c.toString().trim()).join('\n') + '\n' : '',
    keyPem: ok ? (key.export({ type: 'pkcs8', format: 'pem' }) as string) : '',
  };
}

/** Infos zu einem PEM-Zertifikat (z. B. aktuell ausgeliefertes Zertifikat). */
export function describePem(pem: string | Buffer, now = new Date()): CertInfo {
  const c = new X509Certificate(pem);
  const to = new Date(c.validTo);
  return {
    subject: c.subject.replace(/\n/g, ', '), issuer: c.issuer.replace(/\n/g, ', '), subjectAltName: c.subjectAltName ?? null,
    serialNumber: c.serialNumber, validFrom: new Date(c.validFrom).toISOString(), validTo: to.toISOString(),
    daysRemaining: Math.floor((to.getTime() - now.getTime()) / 86_400_000), fingerprint256: c.fingerprint256,
    key: keyDescription(c.publicKey).text, selfSigned: c.checkIssued(c), chain: [],
  };
}
