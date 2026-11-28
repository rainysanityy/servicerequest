# Testdaten PKCS#12

Wegwerf-Zertifikate **nur für Unit-Tests** (`test/pkcs12.test.ts`), erzeugt mit OpenSSL 3 am 28.11.2026
(Test-Root-CA → Test-Issuing-CA → `portal.firma.de`). Die enthaltenen Schlüssel schützen nichts.

| Datei | Passwort | Inhalt |
|---|---|---|
| `ec-aes.p12` | `Geheim123!` | ECDSA P-384 + Kette, OpenSSL-3-Standard (PBES2/AES-256, MAC SHA-256) |
| `rsa-3des.p12` | `Geheim123!` | RSA 3072 + Kette, Alt-Format 3DES, MAC SHA-1 |
| `rsa-nopass.p12` | *(leer)* | RSA 3072 + Zwischenzertifikat |
| `ec-nochain.p12` | `x` | ohne Kette, Zertifikat AES-128, MAC SHA-512 |
| `rsa-rc2.p12` | `x` | RC2-40 (muss abgelehnt werden) |
| `selfsigned.p12` | `x` | selbstsigniert, 30 Tage |
| `wronghost.p12` | `x` | falscher Hostname `other.firma.de` |
| `nomac.p12` | `x` | ohne MAC |
