// Essais des rappels et appels d'une panne non vue : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = await mkdtemp(join(tmpdir(), 'sentro-relances-'));
process.env.DONNEES_DIR = dossier;
process.env.SIMULATION = '1';
process.env.SENTRO_URL = 'https://portail.exemple';
process.env.STATUT_VU_SECRET = 'cle-de-test-0123456789';

const { executer, relances, signatureVu, COMPOSANTS, TEXTOS_MAX, APPELS_MAX } = await import('../verifier/verifier.mjs');
const panne = (meta = {}) => ({ ...Object.fromEntries(COMPOSANTS.map(c => [c.id, { statut: 'panne' }])), meta: { redemarrages15min: 0, vu: null, ...meta } });
const ok = (meta = {}) => ({ ...Object.fromEntries(COMPOSANTS.map(c => [c.id, { statut: 'operationnel' }])), meta: { redemarrages15min: 0, vu: null, ...meta } });
const lire = async () => JSON.parse(await readFile(join(dossier, 'etat.json'), 'utf8'));
const t0 = Date.parse('2026-11-17T20:00:00Z');
const a = (min) => new Date(t0 + min * 60000);
console.log = () => {};

test('signature identique au portail (HMAC-SHA256, base64url, 22 caracteres)', () => {
  assert.match(signatureVu('mhx3k2a', 'k'), /^[A-Za-z0-9_-]{22}$/);
});

test('rappels aux 5 min, 12 textos au plus ; appels apres 15 min, 3 au plus', () => {
  const inc = { debut: a(0).toISOString(), textos: 1, dernierTexto: a(0).toISOString(), appels: 0, dernierAppel: null, vu: false };
  assert.deepEqual(relances(inc, a(3)), { texto: false, appel: false });
  assert.deepEqual(relances(inc, a(5)), { texto: true, appel: false });
  assert.deepEqual(relances({ ...inc, dernierTexto: a(15).toISOString() }, a(15)), { texto: false, appel: true });
  assert.equal(relances({ ...inc, textos: TEXTOS_MAX }, a(60)).texto, false);
  assert.equal(relances({ ...inc, appels: APPELS_MAX }, a(60)).appel, false);
  assert.deepEqual(relances({ ...inc, vu: true }, a(60)), { texto: false, appel: false });
});

test('panne : textos et appels comptes, arretes quand la panne est vue', async () => {
  await rm(join(dossier, 'etat.json'), { force: true });
  await writeFile(join(dossier, 'historique.json'), JSON.stringify({ jours: {} }));
  await executer(panne(), a(0));
  await executer(panne(), a(5)); // panne confirmee : premier texto
  let e = await lire();
  assert.equal(e.incident.textos, 1);
  for (let m = 10; m <= 25; m += 5) await executer(panne(), a(m));
  e = await lire();
  assert.equal(e.incident.textos, 5);
  assert.equal(e.incident.appels, 2); // a 20 et 25 min (15 min apres la confirmation)
  await executer(panne({ vu: e.incident.id }), a(30));
  e = await lire();
  assert.equal(e.incident.vu, true);
  await executer(panne({ vu: e.incident.id }), a(35));
  assert.equal((await lire()).incident.textos, 5);
  await executer(ok(), a(40));
  assert.equal((await lire()).incident, null);
});

test('redemarrages : alerte au-dela de 3 en 15 min, une seule fois', async () => {
  await rm(join(dossier, 'etat.json'), { force: true });
  await executer(ok({ redemarrages15min: 4 }), a(0));
  assert.equal((await lire()).redemarrages.alerte, true);
  await executer(ok({ redemarrages15min: 2 }), a(5));
  assert.equal((await lire()).redemarrages.alerte, false);
  await rm(dossier, { recursive: true, force: true });
});
