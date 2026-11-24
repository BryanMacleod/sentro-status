// Essais de la langue de la page d'etat : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const L = require('../langue.js');

test('choix de la langue : ?lang= l\'emporte, puis le choix memorise, puis le navigateur', () => {
  assert.equal(L.choisirLangue({ navigateur: ['en-US', 'fr'] }), 'en');
  assert.equal(L.choisirLangue({ navigateur: ['EN'] }), 'en');
  assert.equal(L.choisirLangue({ navigateur: ['fr-CA', 'en'] }), 'fr');
  assert.equal(L.choisirLangue({ navigateur: ['es'] }), 'fr');
  assert.equal(L.choisirLangue({ navigateur: [] }), 'fr');
  assert.equal(L.choisirLangue({}), 'fr');
  assert.equal(L.choisirLangue({ memorisee: 'en', navigateur: ['fr-CA'] }), 'en');
  assert.equal(L.choisirLangue({ memorisee: 'fr', navigateur: ['en-CA'] }), 'fr');
  assert.equal(L.choisirLangue({ parametre: 'en', memorisee: 'fr', navigateur: ['fr-CA'] }), 'en');
  assert.equal(L.choisirLangue({ parametre: 'fr', memorisee: 'en', navigateur: ['en-CA'] }), 'fr');
  // Valeurs inconnues : ignorees.
  assert.equal(L.choisirLangue({ parametre: 'de', memorisee: 'xx', navigateur: ['en-GB'] }), 'en');
});

test('dictionnaire : memes cles en francais et en anglais', () => {
  const cles = t => Object.keys(t).sort();
  assert.deepEqual(cles(L.TEXTES.en), cles(L.TEXTES.fr));
  assert.deepEqual(cles(L.TEXTES.en.statuts), cles(L.TEXTES.fr.statuts));
  assert.deepEqual(cles(L.TEXTES.en.global), cles(L.TEXTES.fr.global));
});

test('noms des services : ceux de verifier.mjs sont reconnus pour la traduction', async () => {
  process.env.SIMULATION = '1';
  const { COMPOSANTS } = await import('../verifier/verifier.mjs');
  for (const { id, nom } of COMPOSANTS) assert.equal(L.COMPOSANTS[id].fr, nom);
});

test('messages automatiques traduits : titre, detection, retablissement, aussi en panne, retabli', () => {
  assert.equal(L.traduireAuto('Panne : Portail web, Connexion, Base de données, Tâches planifiées'), 'Outage: Web portal, Sign-in, Database, Scheduled tasks');
  assert.equal(
    L.traduireAuto('Panne détectée à 15 h 16 (heure du Québec) par la vérification automatique.\n\nServices touchés : Portail web, Stockage des fichiers.\n\n@BryanMacleod'),
    'Outage detected at 3:16 p.m. (Eastern Time) by automated monitoring.\n\nAffected services: Web portal, File storage.');
  assert.equal(L.traduireAuto('Rétabli à 15 h 30. Durée de la panne : 14 min.'), 'Restored at 3:30 p.m. Outage duration: 14 min.');
  assert.equal(L.traduireAuto('Rétabli à 00 h 05. Durée de la panne : 1 h 05.'), 'Restored at 12:05 a.m. Outage duration: 1 hr 5 min.');
  assert.equal(L.traduireAuto('Rétabli à 09 h 00. Durée de la panne : 2 h 00.'), 'Restored at 9:00 a.m. Outage duration: 2 hr.');
  assert.equal(L.traduireAuto('15 h 20 : aussi en panne : Courriels, Notifications.'), '3:20 p.m.: also down: Email, Notifications.');
  assert.equal(L.traduireAuto('12 h 45 : rétabli : Sauvegardes.'), '12:45 p.m.: restored: Backups.');
});

test('texte qui ne correspond a aucune forme : garde tel quel', () => {
  assert.equal(L.traduireAuto('Mise à jour du portail'), null);
  assert.equal(L.traduireAuto('Panne : Portail web, Service inconnu'), null);
  assert.equal(L.traduireAuto('Rétabli à 15 h 30. Durée de la panne : 24 min au total, avec la coupure de 15 h 11.'), null);
  assert.equal(L.localiser('Mise à jour du portail', 'en'), 'Mise à jour du portail');
  assert.equal(L.localiser('Panne : Portail web', 'fr'), 'Panne : Portail web');
  assert.equal(L.localiser('Panne : Portail web', 'en'), 'Outage: Web portal');
});

test('separateur ---EN--- : partie de la langue, texte tel quel sans separateur', () => {
  const texte = 'Maintenance du portail le 20 novembre à 23 h 00.\n\n---EN---\n\nPortal maintenance on November 20 at 11:00 p.m.';
  assert.equal(L.localiser(texte, 'fr'), 'Maintenance du portail le 20 novembre à 23 h 00.');
  assert.equal(L.localiser(texte, 'en'), 'Portal maintenance on November 20 at 11:00 p.m.');
  // Fins de ligne Windows et espaces autour du separateur.
  assert.equal(L.localiser('Bonjour\r\n  ---EN---  \r\nHello', 'en'), 'Hello');
  // Titre sur une ligne.
  assert.equal(L.localiser('Mise à jour du portail ---EN--- Portal update', 'fr'), 'Mise à jour du portail');
  assert.equal(L.localiser('Mise à jour du portail ---EN--- Portal update', 'en'), 'Portal update');
  // Un trait markdown « --- » n'est pas un separateur.
  assert.equal(L.partie('Texte\n---\nSuite', 'en'), null);
  // Le separateur ne coupe pas un mot au milieu d'une ligne de plusieurs lignes.
  assert.equal(L.partie('Voir ---EN--- ici\nfin', 'en'), null);
});

test('messages bilingues de verifier.mjs : francais puis anglais, lus par la page', async () => {
  process.env.SIMULATION = '1';
  const { bilingue } = await import('../verifier/verifier.mjs');
  const m = bilingue('Rétabli à 15 h 30. Durée de la panne : 24 min.');
  assert.equal(m, 'Rétabli à 15 h 30. Durée de la panne : 24 min.\n\n---EN---\n\nRestored at 3:30 p.m. Outage duration: 24 min.');
  assert.equal(L.localiser(m, 'fr'), 'Rétabli à 15 h 30. Durée de la panne : 24 min.');
  assert.equal(L.localiser(m, 'en'), 'Restored at 3:30 p.m. Outage duration: 24 min.');
  const corps = `${bilingue('Panne détectée à 15 h 00 (heure du Québec) par la vérification automatique.\n\nServices touchés : Portail web.')}\n\n@BryanMacleod`;
  assert.equal(L.localiser(corps, 'fr'), 'Panne détectée à 15 h 00 (heure du Québec) par la vérification automatique.\n\nServices touchés : Portail web.');
  assert.match(L.localiser(corps, 'en'), /^Outage detected at 3:00 p\.m\. \(Eastern Time\) by automated monitoring\.\n\nAffected services: Web portal\.\n\n@BryanMacleod$/);
});

test('maintenance bilingue : l\'heure de debut est lue dans la partie francaise', async () => {
  process.env.SIMULATION = '1';
  const { debutMaintenance } = await import('../verifier/verifier.mjs');
  const debut = debutMaintenance({
    created_at: '2026-11-15T12:00:00Z',
    // « 2 h » dans l'anglais ne doit pas etre pris pour l'heure de debut.
    title: 'Mise à jour du portail ---EN--- Portal update, 2 h window',
    body: 'Le 20 novembre à 23 h 00.\n---EN---\nNovember 20 at 11:00 p.m.',
  });
  assert.equal(debut.toISOString(), '2026-11-21T04:00:00.000Z');
});

test('nombres et dates en anglais (heure de Montreal)', () => {
  assert.equal(L.pourcent(0.98337, 'en'), '98.33%');
  assert.equal(L.pourcent(0.98337, 'fr'), '98,33 %');
  assert.equal(L.pourcent(0.99999, 'en'), '99.99%');
  assert.equal(L.dateLisible('2026-11-12', 'en'), 'November 12, 2026');
  assert.equal(L.dateLisible('2026-11-12', 'fr'), '12 novembre 2026');
  assert.equal(L.quand('2026-11-12T20:00:12Z', 'en'), 'November 12 at 3:00 p.m.');
  assert.equal(L.quand('2026-11-12T20:00:12Z', 'fr'), '12 novembre à 15 h 00');
  // Heure avancee (EDT) : 13 h 51 le 10 juillet.
  assert.equal(L.heure('2026-07-10T17:51:00Z', 'en'), '1:51 p.m.');
  // Journee de Montreal differente de la journee UTC.
  assert.equal(L.quand('2026-11-15T02:10:51Z', 'en'), 'November 14 at 9:10 p.m.');
  const en = L.textes('en');
  assert.equal(en.panneMin(24), 'about 24 min of downtime');
  assert.equal(en.duree(24), '24 min');
  assert.equal(en.duree(90), '1 hr 30 min');
  assert.equal(en.ilYa(0), 'just now');
  assert.equal(en.ilYa(3), '3 min ago');
  assert.equal(en.ilYa(60 * 30), '1 day ago');
  assert.equal(en.jours(1), '1 day');
  assert.equal(L.textes('xx').code, 'fr-CA');
});

test('corrections du 12 novembre : version anglaise du message d\'explication dans app.js', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const en = /const EXPLICATION_12_NOVEMBRE_EN = `([\s\S]*?)`;/.exec(app)[1];
  assert.match(en, /On November 12, the portal was unavailable for 24 minutes\. No data was lost/);
  assert.doesNotMatch(en, /twice|3:0\d|3:1\d|20 minutes/);
  assert.match(app, /DUREE_GROUPE_CORRIGEE = \{ 19: 24 \}/);
});
