// Essais du calcul des pannes de la page d'etat : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../calcul.js');

const MIN = 60000;
const t0 = Date.parse('2026-11-12T20:00:00Z'); // 15 h a Montreal
const coupure = (debutMin, dureeMin, base = t0) => [base + debutMin * MIN, base + (debutMin + dureeMin) * MIN];
const minutesComptees = (coupures) => C.pannesComptees(coupures).reduce((s, p) => s + p.dureeMs, 0) / MIN;

test('constantes : 15 min pour compter une panne, 60 min pour regrouper', () => {
  assert.equal(C.PANNE_MIN, 15);
  assert.equal(C.REGROUPEMENT_MIN, 60);
});

test('10 min seule : rien', () => assert.equal(minutesComptees([coupure(0, 10)]), 0));
test('14 min seule : rien', () => assert.equal(minutesComptees([coupure(0, 14)]), 0));
test('15 min : 15', () => assert.equal(minutesComptees([coupure(0, 15)]), 15));
test('16 min : 16', () => assert.equal(minutesComptees([coupure(0, 16)]), 16));

test('3 min puis 14 min a 20 min d\'ecart : une panne de 17 min', () => {
  const pannes = C.pannesComptees([coupure(0, 3), coupure(23, 14)]);
  assert.equal(pannes.length, 1);
  assert.equal(pannes[0].dureeMs / MIN, 17);
  assert.equal(C.pannesParJour(pannes)['2026-11-12'] / MIN, 17);
});

test('3 min puis 14 min a 2 h d\'ecart : rien', () => {
  assert.equal(minutesComptees([coupure(0, 3), coupure(3 + 120, 14)]), 0);
});

test('regroupement : 59 min d\'ecart regroupe, 60 min non', () => {
  assert.equal(minutesComptees([coupure(0, 8), coupure(8 + 59, 8)]), 16);
  assert.equal(minutesComptees([coupure(0, 8), coupure(8 + 60, 8)]), 0);
});

test('verification en retard : la coupure va du premier echec au premier succes, retard compris', () => {
  // Coupure reelle d'environ 6 min, mais la verification suivante arrive
  // 20 min apres le premier echec : la regle mesure 20 min, donc comptee.
  assert.equal(minutesComptees([coupure(0, 20)]), 20);
});

test('panne a cheval sur minuit, heure normale (EST, UTC-5) : repartie selon l\'heure reelle', () => {
  // 23 h 55 le 12 nov. a Montreal = 04 h 55 UTC le 13 ; jusqu'a 00 h 12.
  const debut = Date.parse('2026-11-13T04:55:00Z');
  const pannes = C.pannesComptees([[debut, debut + 17 * MIN]]);
  const parJour = C.pannesParJour(pannes);
  assert.deepEqual(Object.fromEntries(Object.entries(parJour).map(([j, v]) => [j, v / MIN])), { '2026-11-12': 5, '2026-11-13': 12 });
});

test('panne a cheval sur minuit, heure avancee (EDT, UTC-4) : repartie selon l\'heure reelle', () => {
  // 23 h 50 le 14 juillet a Montreal = 03 h 50 UTC le 15 ; jusqu'a 00 h 10.
  const debut = Date.parse('2026-07-15T03:50:00Z');
  const parJour = C.pannesParJour(C.pannesComptees([[debut, debut + 20 * MIN]]));
  assert.deepEqual(Object.fromEntries(Object.entries(parJour).map(([j, v]) => [j, v / MIN])), { '2026-07-14': 10, '2026-07-15': 10 });
});

test('journee UTC differente de la journee de Montreal : 02 h 10 UTC le 15 nov. est le 14 a Montreal', () => {
  assert.equal(C.jourMontreal(Date.parse('2026-11-15T02:10:51Z')), '2026-11-14');
  assert.equal(C.jourMontreal(Date.parse('2026-07-15T03:59:00Z')), '2026-07-14');
  assert.equal(C.jourMontreal(Date.parse('2026-07-15T04:00:00Z')), '2026-07-15');
});

test('longueur des journees de Montreal aux changements d\'heure', () => {
  const heures = j => (C.bornesJour(j)[1] - C.bornesJour(j)[0]) / 3600000;
  assert.equal(heures('2026-11-12'), 24);
  assert.equal(heures('2026-11-01'), 25);
  assert.equal(heures('2026-03-08'), 23);
});

test('donnees reelles du 12 novembre (journaux GitHub Actions) : environ 24 min comptees', async () => {
  const { readFile } = await import('node:fs/promises');
  const reprise = JSON.parse(await readFile(new URL('../verifier/coupures-mesurees.json', import.meta.url), 'utf8'));
  const parJour = C.pannesParJour(C.pannesComptees(reprise.coupures.portail));
  const min = parJour['2026-11-12'] / MIN;
  assert.ok(Math.abs(min - 23.92) < 0.01, String(min));
  assert.equal(Math.floor((1 - min / C.minutesSurveillees('2026-11-12', Date.parse('2026-11-20T00:00:00Z'))) * 10000) / 100, 98.33);
});

test('donnees reelles du 14 novembre au soir : une coupure de 4 min 32 s, non comptee', () => {
  const parJour = C.pannesParJour(C.pannesComptees([['2026-11-15T02:10:51.571Z', '2026-11-15T02:15:23.191Z']]));
  assert.deepEqual(parJour, {});
});

test('journee en cours : base du pourcentage jusqu\'a maintenant', () => {
  const [debut] = C.bornesJour('2026-11-12');
  assert.equal(C.minutesSurveillees('2026-11-12', debut + 90 * MIN), 90);
});
