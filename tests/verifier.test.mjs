// Essais de l'enregistrement des coupures par la verification : node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = await mkdtemp(join(tmpdir(), 'sentro-status-'));
process.env.DONNEES_DIR = dossier;
process.env.SIMULATION = '1';

// Portail factice qui repond 503 partout (hebergeur en reconstruction).
const serveur = createServer((_, r) => { r.writeHead(503); r.end('Service Unavailable'); });
await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
process.env.SENTRO_URL = `http://127.0.0.1:${serveur.address().port}`;

const { executer, verifier, COMPOSANTS } = await import('../verifier/verifier.mjs');

const ok = Object.fromEntries(COMPOSANTS.map(c => [c.id, { statut: 'operationnel' }]));
const panne = Object.fromEntries(COMPOSANTS.map(c => [c.id, { statut: 'panne' }]));
const lire = async nom => JSON.parse(await readFile(join(dossier, nom), 'utf8'));
const vider = async () => {
  await rm(join(dossier, 'etat.json'), { force: true });
  await writeFile(join(dossier, 'historique.json'), JSON.stringify({ jours: {} }));
};

before(() => { console.log = () => {}; });
after(async () => { serveur.close(); await rm(dossier, { recursive: true, force: true }); });

test('reponse 503 : comptee comme panne (premier et second essai)', { timeout: 60000 }, async () => {
  const r = await verifier();
  assert.equal(r.portail.statut, 'panne');
  assert.match(r.portail.cause, /HTTP 503/);
  assert.equal(r.connexion.statut, 'panne');
});

test('coupure enregistree du premier echec au premier succes', async () => {
  await vider();
  await executer(ok, new Date('2026-11-15T02:05:24Z'));
  await executer(panne, new Date('2026-11-15T02:10:51Z'));
  assert.equal((await lire('etat.json')).composants.portail.premierEchec, '2026-11-15T02:10:51.000Z');
  await executer(panne, new Date('2026-11-15T02:15:20Z'));
  await executer(ok, new Date('2026-11-15T02:20:23Z'));
  const h = await lire('historique.json');
  assert.deepEqual(h.coupures.portail, [['2026-11-15T02:10:51.000Z', '2026-11-15T02:20:23.000Z']]);
  assert.equal((await lire('etat.json')).composants.portail.premierEchec, undefined);
  // Journee de Montreal : 21 h 10 le 14 novembre.
  assert.ok(h.jours['2026-11-14']);
  assert.equal(h.jours['2026-11-15'], undefined);
});

test('verification « inconnu » : ne ferme pas la coupure', async () => {
  await vider();
  const inconnu = Object.fromEntries(COMPOSANTS.map(c => [c.id, { statut: 'inconnu' }]));
  await executer(panne, new Date('2026-11-20T20:00:00Z'));
  await executer(inconnu, new Date('2026-11-20T20:05:00Z'));
  await executer(ok, new Date('2026-11-20T20:10:00Z'));
  assert.deepEqual((await lire('historique.json')).coupures.base, [['2026-11-20T20:00:00.000Z', '2026-11-20T20:10:00.000Z']]);
});

test('reprise des coupures mesurees du 12 novembre : ajoutees une seule fois si la journee existe', async () => {
  await vider();
  await writeFile(join(dossier, 'historique.json'), JSON.stringify({ jours: { '2026-11-12': { portail: { operationnel: 285, panne: 6 } } } }));
  await executer(ok, new Date('2026-11-15T05:00:00Z'));
  await executer(ok, new Date('2026-11-15T05:05:00Z'));
  const h = await lire('historique.json');
  assert.equal(h.coupures.portail.length, 2);
  assert.equal(h.coupuresDepuis, '2026-11-15T05:00:00.000Z');
  // Compteurs inchanges : rien n'est reecrit en vert.
  assert.equal(h.jours['2026-11-12'].portail.panne, 6);
});
