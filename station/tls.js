// ============================================================
//  Certificado autofirmado para el servidor HTTPS local.
//  El servidor de la API local escucha en https://127.0.0.1 y la
//  página de LEIA (servida por https) le hace fetch: un fetch de
//  https -> http se bloquea por "mixed content", así que el
//  servidor local TIENE que ser https. Como no hay CA pública, se
//  genera un certificado autofirmado en cada arranque y se acota su
//  aceptación a 127.0.0.1:<puerto> en el proceso principal
//  (app.on('certificate-error')), sin tocar webSecurity global.
// ============================================================

const selfsigned = require('selfsigned');

// Genera { key, cert } en PEM para 127.0.0.1 / localhost.
function generateCert(commonName) {
  const attrs = [{ name: 'commonName', value: commonName || '127.0.0.1' }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS
          { type: 7, ip: '127.0.0.1' }     // IP
        ]
      }
    ]
  });
  return { key: pems.private, cert: pems.cert };
}

module.exports = { generateCert };
