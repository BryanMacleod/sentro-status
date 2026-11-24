import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOSSIER = process.env.DONNEES_DIR || 'donnees';
const URL_SENTRO = (process.env.SENTRO_URL || '').replace(/\/+$/, '');
const SIMULATION = process.env.SIMULATION === '1';
const JOURS_GARDES = 90;
const FUSEAU = 'America/Toronto';

export const COMPOSANTS = [
  { id: 'portail', nom: 'Portail web' },
  { id: 'connexion', nom: 'Connexion' },
  { id: 'base', nom: 'Base de données' },
  { id: 'courriels', nom: 'Courriels' },
  { id: 'notifications', nom: 'Notifications' },
  { id: 'stockage', nom: 'Stockage des fichiers' },
  { id: 'sauvegardes', nom: 'Sauvegardes' },
  { id: 'taches', nom: 'Tâches planifiées' },
];
const INTERNES = ['base', 'courriels', 'notifications', 'stockage', 'sauvegardes', 'taches'];
const SEUIL_ALERTE = { portail: 1, connexion: 1 };
const SEUIL_DEFAUT = 2;

const pause = (ms) => new Promise(r => setTimeout(r, ms));

async function appeler(chemin, { json = false, delai = 15000 } = {}) {
  const debut = Date.now();
  try {
    const r = await fetch(`${URL_SENTRO}${chemin}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(delai),
      headers: { 'User-Agent': 'SentroStatus/1.0 (+status.groupesentro.ca)', Accept: json ? 'application/json' : 'text/html' },
    });
    const latenceMs = Date.now() - debut;
    if (!r.ok) return { ok: false, latenceMs };
    return { ok: true, latenceMs, corps: json ? await r.json().catch(() => null) : null };
  } catch {
    return { ok: false, latenceMs: Date.now() - debut };
  }
}

async function verifierExterne() {
  const portail = await appeler('/connexion');
  const connexion = await appeler('/api/auth/csrf', { json: true });
  return {
    portail: { statut: !portail.ok ? 'panne' : portail.latenceMs > 5000 ? 'degrade' : 'operationnel', latenceMs: portail.latenceMs },
    connexion: { statut: connexion.ok && connexion.corps?.csrfToken ? 'operationnel' : 'panne' },
  };
}

export async function verifier() {
  if (!URL_SENTRO) throw new Error('SENTRO_URL manquant');
  let externe = await verifierExterne();
  if (externe.portail.statut === 'panne' || externe.connexion.statut === 'panne') {
    await pause(30000);
    externe = await verifierExterne();
  }
  const statut = await appeler('/api/statut', { json: true, delai: 20000 });
  const internes = {};
  for (const id of INTERNES) {
    const s = statut.ok ? statut.corps?.composants?.[id]?.statut : null;
    internes[id] = { statut: s ?? (externe.portail.statut === 'panne' ? 'panne' : 'inconnu') };
    if (id === 'base' && statut.corps?.composants?.base?.latenceMs != null) internes.base.latenceMs = statut.corps.composants.base.latenceMs;
  }
  return { ...externe, ...internes };
}

function jourQuebec(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function heureQuebec(date) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(date);
}

function duree(depuisIso, maintenant) {
  const min = Math.max(1, Math.round((maintenant - new Date(depuisIso)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

async function lireJson(nom, defaut) {
  try { return JSON.parse(await readFile(join(DOSSIER, nom), 'utf8')); } catch { return defaut; }
}

async function texto(message) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: jeton, TWILIO_FROM: de, ALERTE_TEL: a } = process.env;
  if (SIMULATION) { console.log(`[simulation] texto : ${message}`); return; }
  if (!sid || !jeton || !de || !a) { console.log('Texto non envoyé : secrets Twilio ou ALERTE_TEL absents.'); return; }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${jeton}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: de, To: a, Body: message }),
  }).catch(() => null);
  console.log(r?.ok ? 'Texto envoyé.' : `Texto en échec (${r?.status ?? 'réseau'}).`);
}

async function github(chemin, options = {}) {
  const { GITHUB_TOKEN: jeton, GITHUB_REPOSITORY: depot } = process.env;
  if (SIMULATION || !jeton || !depot) { console.log(`[simulation] GitHub ${options.method ?? 'GET'} ${chemin}`); return null; }
  const r = await fetch(`https://api.github.com/repos/${depot}${chemin}`, {
    ...options,
    headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
  }).catch(() => null);
  if (!r?.ok) { console.log(`GitHub ${chemin} : ${r?.status ?? 'réseau'}`); return null; }
  return r.status === 204 ? {} : r.json();
}

const nomDe = (id) => COMPOSANTS.find(c => c.id === id)?.nom ?? id;
const proprietaire = () => (process.env.GITHUB_REPOSITORY || '').split('/')[0];

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const DUREE_MAX_MAINTENANCE = 3 * 60 * 60000;

function ecartQuebec(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - t;
}

function heureQuebecVersDate(a, mo, j, h, mi) {
  const voulu = Date.UTC(a, mo, j, h, mi);
  const premier = voulu - ecartQuebec(voulu);
  return new Date(voulu - ecartQuebec(premier));
}

export function debutMaintenance(issue) {
  const cree = new Date(issue.created_at);
  const texte = `${issue.title ?? ''} ${issue.body ?? ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const heure = texte.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/);
  if (!heure || Number(heure[1]) > 23) return cree;
  const date = texte.match(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MOIS.join('|')})(?:\\s+(\\d{4}))?`));
  const [a, mo, j] = jourQuebec(cree).split('-').map(Number);
  let debut = date
    ? heureQuebecVersDate(date[3] ? Number(date[3]) : a, MOIS.indexOf(date[2]), Number(date[1]), Number(heure[1]), Number(heure[2] ?? 0))
    : heureQuebecVersDate(a, mo - 1, j, Number(heure[1]), Number(heure[2] ?? 0));
  if (!date && debut < cree.getTime() - 30 * 60000) debut = new Date(debut.getTime() + 24 * 60 * 60000);
  return debut;
}

export function maintenanceActive(issues, maintenant = new Date()) {
  return issues.some(i => {
    const debut = debutMaintenance(i).getTime();
    return maintenant.getTime() >= debut - 5 * 60000 && maintenant.getTime() <= debut + DUREE_MAX_MAINTENANCE;
  });
}

export async function executer(resultats, maintenant = new Date(), { maintenance = false } = {}) {
  await mkdir(DOSSIER, { recursive: true });
  const etat = await lireJson('etat.json', { composants: {}, incident: null });
  const historique = await lireJson('historique.json', { jours: {} });
  const iso = maintenant.toISOString();

  const enPanne = [];
  const retablis = [];
  for (const { id } of COMPOSANTS) {
    const brut = resultats[id] ?? { statut: 'inconnu' };
    const r = maintenance && (brut.statut === 'panne' || brut.statut === 'degrade') ? { ...brut, statut: 'maintenance' } : brut;
    const avant = etat.composants[id] ?? { statut: 'inconnu', depuis: iso, pannesConsecutives: 0, alerte: false };
    const pannes = r.statut === 'panne' ? (avant.pannesConsecutives ?? 0) + 1 : 0;
    const seuil = SEUIL_ALERTE[id] ?? SEUIL_DEFAUT;
    let alerte = avant.alerte ?? false;
    if (!alerte && pannes >= seuil) { alerte = true; enPanne.push(id); }
    if (alerte && r.statut !== 'panne' && r.statut !== 'inconnu' && r.statut !== 'maintenance') { alerte = false; retablis.push(id); }
    etat.composants[id] = {
      statut: r.statut,
      depuis: r.statut === avant.statut ? avant.depuis : iso,
      pannesConsecutives: pannes,
      alerte,
      ...(r.latenceMs != null ? { latenceMs: r.latenceMs } : {}),
    };
  }
  const statuts = Object.values(etat.composants).map(c => c.statut);
  etat.global = statuts.includes('panne') ? 'panne' : statuts.includes('maintenance') ? 'maintenance' : statuts.includes('degrade') ? 'degrade' : 'operationnel';
  etat.verifieA = iso;

  const jour = jourQuebec(maintenant);
  historique.jours[jour] ??= {};
  for (const { id } of COMPOSANTS) {
    const c = (historique.jours[jour][id] ??= { operationnel: 0, degrade: 0, panne: 0, inconnu: 0 });
    c[etat.composants[id].statut] = (c[etat.composants[id].statut] ?? 0) + 1;
  }
  const jours = Object.keys(historique.jours).sort();
  for (const j of jours.slice(0, Math.max(0, jours.length - JOURS_GARDES))) delete historique.jours[j];

  const enAlerte = COMPOSANTS.filter(c => etat.composants[c.id].alerte).map(c => c.id);
  if (enPanne.length > 0) {
    const noms = enPanne.map(nomDe).join(', ');
    await texto(`Sentro : PANNE ${noms} (${heureQuebec(maintenant)}). status.groupesentro.ca`);
    if (!etat.incident) {
      const issue = await github('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: `Panne : ${enAlerte.map(nomDe).join(', ')}`,
          body: `Panne détectée à ${heureQuebec(maintenant)} (heure du Québec) par la vérification automatique.\n\nServices touchés : ${enAlerte.map(nomDe).join(', ')}.\n\n@${proprietaire()}`,
          labels: ['incident', 'automatique'],
        }),
      });
      etat.incident = { numero: issue?.number ?? null, debut: iso, composants: enAlerte };
    } else {
      if (etat.incident.numero) {
        await github(`/issues/${etat.incident.numero}/comments`, { method: 'POST', body: JSON.stringify({ body: `${heureQuebec(maintenant)} : aussi en panne : ${noms}.` }) });
      }
      etat.incident.composants = [...new Set([...etat.incident.composants, ...enPanne])];
    }
  }
  if (retablis.length > 0) {
    const noms = retablis.map(nomDe).join(', ');
    if (enAlerte.length === 0 && etat.incident) {
      const d = duree(etat.incident.debut, maintenant);
      await texto(`Sentro : rétabli (${noms}) à ${heureQuebec(maintenant)}, panne de ${d}.`);
      if (etat.incident.numero) {
        await github(`/issues/${etat.incident.numero}/comments`, { method: 'POST', body: JSON.stringify({ body: `Rétabli à ${heureQuebec(maintenant)}. Durée de la panne : ${d}.` }) });
        await github(`/issues/${etat.incident.numero}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      }
      etat.incident = null;
    } else {
      await texto(`Sentro : rétabli ${noms} à ${heureQuebec(maintenant)}. Encore en panne : ${enAlerte.map(nomDe).join(', ')}.`);
      if (etat.incident?.numero) await github(`/issues/${etat.incident.numero}/comments`, { method: 'POST', body: JSON.stringify({ body: `${heureQuebec(maintenant)} : rétabli : ${noms}.` }) });
    }
  }

  await writeFile(join(DOSSIER, 'etat.json'), JSON.stringify(etat, null, 1));
  await writeFile(join(DOSSIER, 'historique.json'), JSON.stringify(historique));
  console.log(`État global : ${etat.global}. ${COMPOSANTS.map(c => `${c.id}=${etat.composants[c.id].statut}`).join(' ')}`);
  return etat;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const existantes = new Set(((await github('/labels?per_page=100')) ?? []).map(l => l.name));
  for (const [name, color, description] of [
    ['incident', 'b60205', 'Panne ou perturbation'],
    ['maintenance', '1d76db', 'Maintenance prévue'],
    ['automatique', 'ededed', 'Ouvert automatiquement'],
  ]) {
    if (!SIMULATION && !existantes.has(name)) await github('/labels', { method: 'POST', body: JSON.stringify({ name, color, description }) });
  }
  const ouvertes = (await github('/issues?state=open&labels=maintenance&per_page=20')) ?? [];
  const resultats = await verifier();
  await executer(resultats, new Date(), { maintenance: maintenanceActive(ouvertes) });
}
