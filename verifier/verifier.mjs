import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';

// Messages publics (issues et commentaires) : francais, puis anglais apres
// une ligne « ---EN--- » (voir langue.js). Le texto interne reste en francais.
const SentroLangue = createRequire(import.meta.url)('../langue.js');
export const bilingue = (fr) => SentroLangue.bilingue(fr, SentroLangue.traduireAuto(fr) ?? fr);

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
  { id: 'restauration', nom: 'Test de restauration' },
  { id: 'taches', nom: 'Tâches planifiées' },
];
const INTERNES = ['base', 'courriels', 'notifications', 'stockage', 'sauvegardes', 'restauration', 'taches'];
// Alerte (texto + incident) apres deux verifications en panne de suite :
// une coupure de quelques secondes vue une seule fois ne merite pas d'alerte.
const SEUIL_ALERTE = {};
const SEUIL_DEFAUT = 2;

const pause = (ms) => new Promise(r => setTimeout(r, ms));

// Panne non acquittee : rappel par texto aux 5 minutes (12 textos au plus par
// panne, le premier compris), puis appel vocal apres 15 minutes (3 au plus,
// 5 minutes d'ecart). « J'ai vu » : lien signe du texto (/api/statut/vu,
// secret STATUT_VU_SECRET, le meme que dans le .env du portail) ou reponse
// « VU » au texto. Redemarrages du portail : alerte au-dela de 3 en 15 min.
export const TEXTOS_MAX = 12;
export const APPELS_MAX = 3;
const RAPPEL_MS = 5 * 60000;
const APPEL_APRES_MS = 15 * 60000;
export const REDEMARRAGES_MAX = 3;

/** Signature du lien « J'ai vu » (meme calcul que src/lib/statut-vu.ts du portail). */
export function signatureVu(id, secret) {
  return createHmac('sha256', secret).update(id).digest('base64url').slice(0, 22);
}

function lienVu(id) {
  const secret = process.env.STATUT_VU_SECRET;
  return secret && URL_SENTRO ? `${URL_SENTRO}/api/statut/vu?i=${id}&s=${signatureVu(id, secret)}` : null;
}

/** Que faire pour une panne en cours : rappel par texto, appel vocal (pur, teste). */
export function relances(incident, maintenant) {
  if (!incident || incident.vu) return { texto: false, appel: false };
  const t = maintenant.getTime();
  const depuis = (iso) => (iso ? t - new Date(iso).getTime() : Infinity);
  return {
    texto: (incident.textos ?? 0) < TEXTOS_MAX && depuis(incident.dernierTexto) >= RAPPEL_MS - 30000,
    appel: (incident.appels ?? 0) < APPELS_MAX && depuis(incident.debut) >= APPEL_APRES_MS - 30000 && depuis(incident.dernierAppel) >= RAPPEL_MS - 30000,
  };
}

async function appeler(chemin, { json = false, delai = 15000 } = {}) {
  const debut = Date.now();
  try {
    const r = await fetch(`${URL_SENTRO}${chemin}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(delai),
      headers: { 'User-Agent': 'SentroStatus/1.0 (+status.groupesentro.ca)', Accept: json ? 'application/json' : 'text/html' },
    });
    const latenceMs = Date.now() - debut;
    if (!r.ok) return { ok: false, latenceMs, cause: `HTTP ${r.status}` };
    return { ok: true, latenceMs, corps: json ? await r.json().catch(() => null) : null };
  } catch (e) {
    const latenceMs = Date.now() - debut;
    return { ok: false, latenceMs, cause: e?.name === 'TimeoutError' ? 'délai dépassé' : 'réseau' };
  }
}

// Cause d'un echec, pour le texto et le journal de la verification (jamais
// dans l'issue : elle est publique sur la page d'etat).
const cause = (r) => (r.ok ? null : `${r.cause ?? 'réponse invalide'} en ${Math.round(r.latenceMs / 100) / 10} s`);

async function verifierExterne() {
  const portail = await appeler('/connexion');
  const connexion = await appeler('/api/auth/csrf', { json: true });
  const connexionOk = connexion.ok && connexion.corps?.csrfToken;
  return {
    portail: { statut: !portail.ok ? 'panne' : 'operationnel', latenceMs: portail.latenceMs, cause: cause(portail) },
    connexion: { statut: connexionOk ? 'operationnel' : 'panne', cause: connexionOk ? null : (cause(connexion) ?? 'jeton absent') },
  };
}

export async function verifier() {
  if (!URL_SENTRO) throw new Error('SENTRO_URL manquant');
  let externe = await verifierExterne();
  if (externe.portail.statut === 'panne' || externe.connexion.statut === 'panne') {
    console.log(`Premier essai : portail=${externe.portail.cause ?? 'ok'} connexion=${externe.connexion.cause ?? 'ok'}`);
    await pause(30000);
    externe = await verifierExterne();
    console.log(`Second essai : portail=${externe.portail.cause ?? 'ok'} connexion=${externe.connexion.cause ?? 'ok'}`);
  }
  const statut = await appeler('/api/statut', { json: true, delai: 20000 });
  if (!statut.ok) console.log(`/api/statut : ${cause(statut)}`);
  const internes = {};
  for (const id of INTERNES) {
    const s = statut.ok ? statut.corps?.composants?.[id]?.statut : null;
    internes[id] = { statut: s ?? (externe.portail.statut === 'panne' ? 'panne' : 'inconnu') };
    if (id === 'base' && statut.corps?.composants?.base?.latenceMs != null) internes.base.latenceMs = statut.corps.composants.base.latenceMs;
  }
  // Redemarrages du portail (15 min) et panne vue par le lien « J'ai vu ».
  const meta = statut.ok ? { redemarrages15min: statut.corps?.redemarrages15min ?? null, vu: statut.corps?.vu ?? null } : { redemarrages15min: null, vu: null };
  return { ...externe, ...internes, meta };
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
  if (SIMULATION) { console.log(`[simulation] texto : ${message}`); return true; }
  if (!sid || !jeton || !de || !a) { console.log('Texto non envoyé : secrets Twilio ou ALERTE_TEL absents.'); return false; }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${jeton}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: de, To: a, Body: message }),
  }).catch(() => null);
  console.log(r?.ok ? 'Texto envoyé.' : `Texto en échec (${r?.status ?? 'réseau'}).`);
  return !!r?.ok;
}

const echapperXml = (s) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function appelVocal(message) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: jeton, TWILIO_FROM: de, ALERTE_TEL: a } = process.env;
  if (SIMULATION) { console.log(`[simulation] appel : ${message}`); return true; }
  if (!sid || !jeton || !de || !a) { console.log('Appel non fait : secrets Twilio ou ALERTE_TEL absents.'); return false; }
  const dit = `<Say language="fr-CA">${echapperXml(message)}</Say>`;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${jeton}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: de, To: a, Twiml: `<Response>${dit}<Pause length="1"/>${dit}</Response>` }),
  }).catch(() => null);
  console.log(r?.ok ? 'Appel lancé.' : `Appel en échec (${r?.status ?? 'réseau'}).`);
  return !!r?.ok;
}

// Reponse « VU » au texto depuis le debut de la panne (Twilio).
async function vuParTexto(debutIso) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: jeton, TWILIO_FROM: de, ALERTE_TEL: a } = process.env;
  if (SIMULATION || !sid || !jeton || !de || !a) return false;
  const q = new URLSearchParams({ To: de, From: a, PageSize: '20' });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${q}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${jeton}`).toString('base64')}` },
  }).catch(() => null);
  if (!r?.ok) return false;
  const corps = await r.json().catch(() => null);
  const debut = new Date(debutIso).getTime();
  return (corps?.messages ?? []).some(m => new Date(m.date_sent ?? m.date_created).getTime() >= debut && /^\s*vu\b/i.test(m.body ?? ''));
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
  // Partie francaise seulement (avant ---EN---) : l'heure y est « 15 h 30 ».
  const fr = (t) => SentroLangue.partie(t, 'fr') ?? (t ?? '');
  const texte = `${fr(issue.title)} ${fr(issue.body)}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

function ajouterCoupure(historique, id, debut, fin) {
  historique.coupures ??= {};
  const liste = (historique.coupures[id] ??= []);
  if (!liste.some(([d]) => d === debut)) liste.push([debut, fin]);
}

// Coupures mesurees avant que la verification ne les enregistre (reprises des
// journaux de GitHub Actions, voir coupures-mesurees.json) : ajoutees une fois,
// seulement si leur journee est encore dans l'historique.
async function reprendreCoupures(historique) {
  let reprise;
  try { reprise = JSON.parse(await readFile(new URL('./coupures-mesurees.json', import.meta.url), 'utf8')); } catch { return; }
  for (const [id, liste] of Object.entries(reprise.coupures ?? {})) {
    for (const [debut, fin] of liste) {
      if (historique.jours[jourQuebec(new Date(debut))]) ajouterCoupure(historique, id, debut, fin);
    }
  }
}

export async function executer(resultats, maintenant = new Date(), { maintenance = false } = {}) {
  await mkdir(DOSSIER, { recursive: true });
  const etat = await lireJson('etat.json', { composants: {}, incident: null });
  const historique = await lireJson('historique.json', { jours: {} });
  const iso = maintenant.toISOString();
  // Premiere verification qui enregistre les coupures : les journees d'avant
  // n'ont que des compteurs (la page garde alors l'ancien calcul).
  historique.coupuresDepuis ??= iso;
  await reprendreCoupures(historique);

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
    // Coupure : du premier echec au premier succes qui suit (lue par la page,
    // voir calcul.js). « inconnu » ne l'ouvre ni ne la ferme ; une maintenance
    // la ferme.
    let premierEchec = avant.premierEchec ?? null;
    if (r.statut === 'panne') premierEchec ??= iso;
    else if (premierEchec && r.statut !== 'inconnu') {
      ajouterCoupure(historique, id, premierEchec, iso);
      premierEchec = null;
    }
    etat.composants[id] = {
      statut: r.statut,
      depuis: r.statut === avant.statut ? avant.depuis : iso,
      pannesConsecutives: pannes,
      alerte,
      ...(premierEchec ? { premierEchec } : {}),
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
    const { statut, pannesConsecutives } = etat.composants[id];
    if (statut === 'panne' && pannesConsecutives < SEUIL_DEFAUT) {
      // Panne vue une seule fois : neutre tant qu'elle n'est pas confirmee.
      c.inconnu = (c.inconnu ?? 0) + 1;
    } else if (statut === 'panne' && pannesConsecutives === SEUIL_DEFAUT && (c.inconnu ?? 0) > 0) {
      // Confirmee : la verification precedente compte aussi comme panne.
      c.inconnu -= 1;
      c.panne = (c.panne ?? 0) + 2;
    } else {
      c[statut] = (c[statut] ?? 0) + 1;
    }
  }
  const jours = Object.keys(historique.jours).sort();
  for (const j of jours.slice(0, Math.max(0, jours.length - JOURS_GARDES))) delete historique.jours[j];
  const premierJour = Object.keys(historique.jours).sort()[0];
  for (const id of Object.keys(historique.coupures ?? {})) {
    historique.coupures[id] = historique.coupures[id].filter(([, fin]) => jourQuebec(new Date(fin)) >= premierJour);
  }

  const enAlerte = COMPOSANTS.filter(c => etat.composants[c.id].alerte).map(c => c.id);
  if (enPanne.length > 0) {
    const noms = enPanne.map(nomDe).join(', ');
    const details = enPanne.map(id => `${nomDe(id)}${resultats[id]?.cause ? ` (${resultats[id].cause})` : ''}`).join(', ');
    const nouvelle = !etat.incident;
    const id = etat.incident?.id ?? maintenant.getTime().toString(36);
    const lien = lienVu(id);
    const envoye = await texto(`Sentro : PANNE ${details} à ${heureQuebec(maintenant)}. ${lien ? `J'ai vu : ${lien}` : 'Répondez VU pour arrêter les rappels.'}`);
    if (!nouvelle && envoye) { etat.incident.textos = (etat.incident.textos ?? 0) + 1; etat.incident.dernierTexto = iso; }
    if (nouvelle) {
      const issue = await github('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: `Panne : ${enAlerte.map(nomDe).join(', ')}`,
          body: `${bilingue(`Panne détectée à ${heureQuebec(maintenant)} (heure du Québec) par la vérification automatique.\n\nServices touchés : ${enAlerte.map(nomDe).join(', ')}.`)}\n\n@${proprietaire()}`,
          labels: ['incident', 'automatique'],
        }),
      });
      etat.incident = { numero: issue?.number ?? null, debut: iso, composants: enAlerte, id, textos: envoye ? 1 : 0, dernierTexto: envoye ? iso : null, appels: 0, dernierAppel: null, vu: false };
    } else {
      if (etat.incident.numero) {
        await github(`/issues/${etat.incident.numero}/comments`, { method: 'POST', body: JSON.stringify({ body: bilingue(`${heureQuebec(maintenant)} : aussi en panne : ${noms}.`) }) });
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
        await github(`/issues/${etat.incident.numero}/comments`, { method: 'POST', body: JSON.stringify({ body: bilingue(`Rétabli à ${heureQuebec(maintenant)}. Durée de la panne : ${d}.`) }) });
        await github(`/issues/${etat.incident.numero}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      }
      etat.incident = null;
    } else {
      await texto(`Sentro : rétabli ${noms} à ${heureQuebec(maintenant)}. Encore en panne : ${enAlerte.map(nomDe).join(', ')}.`);
      if (etat.incident?.numero) await github(`/issues/${etat.incident.numero}/comments`, { method: 'POST', body: JSON.stringify({ body: bilingue(`${heureQuebec(maintenant)} : rétabli : ${noms}.`) }) });
    }
  }

  // Panne toujours en cours et pas encore vue : rappels, puis appels.
  if (etat.incident && enAlerte.length > 0 && enPanne.length === 0) {
    const inc = etat.incident;
    inc.id ??= new Date(inc.debut).getTime().toString(36);
    if (!inc.vu && (resultats.meta?.vu === inc.id || await vuParTexto(inc.debut))) {
      inc.vu = true;
      console.log('Panne vue : rappels arrêtés.');
    }
    const r = relances(inc, maintenant);
    if (r.texto) {
      const lien = lienVu(inc.id);
      if (await texto(`Sentro : rappel, PANNE ${enAlerte.map(nomDe).join(', ')} depuis ${duree(inc.debut, maintenant)}. ${lien ? `J'ai vu : ${lien}` : 'Répondez VU.'}`)) {
        inc.textos = (inc.textos ?? 0) + 1;
        inc.dernierTexto = iso;
      }
    }
    if (r.appel && await appelVocal(`Alerte Sentro. Panne en cours depuis ${duree(inc.debut, maintenant)} : ${enAlerte.map(nomDe).join(', ')}. Consultez vos textos.`)) {
      inc.appels = (inc.appels ?? 0) + 1;
      inc.dernierAppel = iso;
    }
  }

  // Redemarrages en boucle : alerte meme si le portail repond en ce moment.
  const nbRedem = resultats.meta?.redemarrages15min;
  if (typeof nbRedem === 'number') {
    if (nbRedem > REDEMARRAGES_MAX && !etat.redemarrages?.alerte) {
      await texto(`Sentro : ${nbRedem} redémarrages du portail en 15 min à ${heureQuebec(maintenant)}.`);
      etat.redemarrages = { alerte: true, depuis: iso };
    } else if (nbRedem <= REDEMARRAGES_MAX && etat.redemarrages?.alerte) {
      etat.redemarrages = { alerte: false, depuis: iso };
    }
  }

  await writeFile(join(DOSSIER, 'etat.json'), JSON.stringify(etat, null, 1));
  await writeFile(join(DOSSIER, 'historique.json'), JSON.stringify(historique));
  console.log(`État global : ${etat.global}. ${COMPOSANTS.map(c => `${c.id}=${etat.composants[c.id].statut}`).join(' ')}`);
  return etat;
}

// Incidents et leurs messages, publies avec les autres donnees de la page :
// les visiteurs ne lisent plus l'API de GitHub (60 lectures par heure et par
// adresse, au-dela la section des incidents disparaissait). Lu avec le jeton
// de la verification ; en cas d'echec, le fichier precedent est garde.
async function publierIncidents(maintenant = new Date()) {
  const issues = await github('/issues?state=all&per_page=100&sort=created&direction=desc');
  if (!Array.isArray(issues)) return;
  const quatreVingtDixJours = maintenant.getTime() - 90 * 86400000;
  const gardees = issues
    .filter(i => !i.pull_request && i.labels.some(l => l.name === 'incident' || l.name === 'maintenance'))
    .filter(i => i.state === 'open' || new Date(i.closed_at ?? i.created_at).getTime() > quatreVingtDixJours);
  const commentaires = {};
  for (const i of gardees) {
    if (!(i.comments > 0)) continue;
    const c = await github(`/issues/${i.number}/comments?per_page=100`);
    if (!Array.isArray(c)) return;
    commentaires[i.number] = c.map(x => ({ created_at: x.created_at, body: x.body ?? '' }));
  }
  const donnees = {
    a: maintenant.toISOString(),
    issues: gardees.map(i => ({
      number: i.number, title: i.title, body: i.body ?? '', state: i.state,
      labels: i.labels.map(l => ({ name: l.name })), comments: i.comments ?? 0,
      created_at: i.created_at, closed_at: i.closed_at, updated_at: i.updated_at,
    })),
    commentaires,
  };
  await writeFile(join(DOSSIER, 'incidents.json'), JSON.stringify(donnees));
}

if (import.meta.url === `file://${process.argv[1]}` && process.env.TEST === '1') {
  // Mode test (workflow_dispatch, test=1) : un texto pour verifier les secrets Twilio, rien d'autre.
  const ok = await texto(`Sentro : texto de test de la vérification, ${heureQuebec(new Date())}.`);
  process.exit(ok ? 0 : 1);
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
  // Apres la verification : un incident ouvert ou ferme a l'instant y figure.
  await publierIncidents();
}
