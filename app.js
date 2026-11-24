const DEPOT = 'BryanMacleod/sentro-status';
const DONNEES = `https://raw.githubusercontent.com/${DEPOT}/donnees`;
const CONTENU = `https://api.github.com/repos/${DEPOT}/contents`;
const JOURS = 90;
const FUSEAU = 'America/Toronto';
// Perturbation minimale (minutes) pour colorer une journee en jaune.

// Noms et textes : langue.js (un seul dictionnaire, francais et anglais).
const COMPOSANTS = Object.keys(SentroLangue.COMPOSANTS);

const $ = (id) => document.getElementById(id);

// Langue : ?lang= dans l'adresse, sinon le choix memorise, sinon le navigateur.
const CLE_LANGUE = 'sentro-statut:langue';
function langueMemorisee() {
  try { return localStorage.getItem(CLE_LANGUE); } catch { return null; }
}
let langue = SentroLangue.choisirLangue({
  parametre: new URLSearchParams(location.search).get('lang'),
  memorisee: langueMemorisee(),
  navigateur: navigator.languages?.length ? navigator.languages : [navigator.language],
});
let T = SentroLangue.textes(langue);

function appliquerLangue() {
  T = SentroLangue.textes(langue);
  document.documentElement.lang = T.code;
  document.title = T.titrePage;
  document.querySelector('meta[name="description"]')?.setAttribute('content', T.description);
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[el.dataset.t];
  const lien = $('langue');
  const url = new URL(location.href);
  url.searchParams.set('lang', T.autre);
  lien.href = url.search + url.hash;
  lien.textContent = T.nomAutre;
  lien.lang = SentroLangue.textes(T.autre).code;
  lien.hreflang = lien.lang;
}
appliquerLangue();

$('langue').addEventListener('click', e => {
  e.preventDefault();
  langue = T.autre;
  try { localStorage.setItem(CLE_LANGUE, langue); } catch {}
  const url = new URL(location.href);
  url.searchParams.set('lang', langue);
  try { history.replaceState(null, '', url.search + url.hash); } catch {}
  appliquerLangue();
  bulle.hidden = true;
  rafraichir();
  afficherIncidents();
});

function echapper(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Texte d'une issue ou d'un commentaire, dans la langue de la page (partie
// avant/apres « ---EN--- », ou message automatique traduit).
function texteIssue(s) {
  return echapper(SentroLangue.localiser(s, langue).replace(/(^|\s)@[\w-]+/g, '$1').replace(/\r/g, '').trim());
}

function jourQuebec(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const dateLisible = jour => SentroLangue.dateLisible(jour, langue);
const quand = iso => SentroLangue.quand(iso, langue);
const heure = iso => SentroLangue.heure(iso, langue);
const pourcent = x => SentroLangue.pourcent(x, langue);

function ilYa(iso) {
  return T.ilYa(Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function duree(debutIso, finIso) {
  return T.duree(Math.max(1, Math.round((new Date(finIso) - new Date(debutIso)) / 60000)));
}
function derniersJours() {
  const [a, m, j] = jourQuebec(new Date()).split('-').map(Number);
  const jours = [];
  for (let i = JOURS - 1; i >= 0; i--) jours.push(new Date(Date.UTC(a, m - 1, j - i)).toISOString().slice(0, 10));
  return jours;
}

// panneMin : minutes de panne comptees ce jour-la (calcul.js). Journee
// d'avant l'enregistrement des coupures (ancien : true) : seuls les compteurs
// existent, l'ancien calcul (5 min par verification en panne) est garde.
function etatJour(c, { panneMin = 0, minutesJour = 1440, ancien = false } = {}) {
  if (!c) return { classe: '', dispo: null, panneMin: 0, maintenanceMin: 0 };
  const total = (c.operationnel ?? 0) + (c.degrade ?? 0) + (c.panne ?? 0);
  if (total === 0 && panneMin === 0) return (c.maintenance ?? 0) > 0
    ? { classe: 'maintenance', dispo: null, panneMin: 0, maintenanceMin: c.maintenance * 5 }
    : { classe: '', dispo: null, panneMin: 0, maintenanceMin: 0 };
  if (ancien) panneMin = (c.panne ?? 0) * 5;
  const ratio = ancien ? (c.panne ?? 0) / total : Math.min(1, panneMin / Math.max(1, minutesJour));
  // Le jaune demande de la vraie panne : une lenteur (« perturbe ») ne colore
  // jamais la journee, c'est un faux positif (consigne de Gabriel, 19 nov.).
  const classe = ratio >= 0.05 ? 'panne'
    : panneMin > 0 ? 'degrade'
    : (c.maintenance ?? 0) > 0 ? 'maintenance' : 'operationnel';
  return { classe, dispo: 1 - ratio, panneMin: Math.round(panneMin), maintenanceMin: (c.maintenance ?? 0) * 5 };
}

async function lireDonnee(nom) {
  try {
    const r = await fetch(`${CONTENU}/${nom}?ref=donnees`, { cache: 'no-cache', headers: { Accept: 'application/vnd.github.raw+json' } });
    if (r.ok) return await r.json();
  } catch {}
  return lireJson(`${DONNEES}/${nom}`);
}

async function lireJson(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function afficherServices(etat, historique) {
  const tous = derniersJours();
  const premier = Object.keys(historique?.jours ?? {}).sort()[0];
  const depuis = premier && premier > tous[0] ? premier : null;
  const periode = depuis ? tous.filter(j => j >= depuis) : tous;
  // Nombre de jours surveilles, de la premiere journee a aujourd'hui inclus.
  const nbJours = debut => tous.length - tous.indexOf(debut);
  const libelle = debut => debut ? T.surveilleDepuis(T.jours(nbJours(debut))) : T.derniersJours(JOURS);
  const debutPied = debut => T.ilYaJours(T.jours(debut ? nbJours(debut) : JOURS));
  $('legende').textContent = libelle(depuis);

  const maintenant = Date.now();
  const depuisCoupures = historique?.coupuresDepuis ? jourQuebec(new Date(historique.coupuresDepuis)) : null;
  $('composants').innerHTML = COMPOSANTS.map(id => {
    const nom = SentroLangue.COMPOSANTS[id][langue];
    const statut = etat?.composants?.[id]?.statut ?? 'inconnu';
    const cumul = { ok: 0, total: 0 };
    // Coupures enregistrees, plus celle en cours (premier echec -> derniere verification).
    const coupures = [...(historique?.coupures?.[id] ?? [])];
    const ouverte = etat?.composants?.[id]?.premierEchec;
    if (ouverte) coupures.push([ouverte, etat.verifieA ?? new Date(maintenant).toISOString()]);
    const panneParJour = SentroCalcul.pannesParJour(SentroCalcul.pannesComptees(coupures));
    const joursMesures = new Set(coupures.flatMap(([d, f]) => [jourQuebec(new Date(d)), jourQuebec(new Date(f))]));
    const barres = periode.map(j => {
      const c = historique?.jours?.[j]?.[id];
      const minutesJour = SentroCalcul.minutesSurveillees(j, maintenant);
      const ancien = (c?.panne ?? 0) > 0 && !joursMesures.has(j) && (!depuisCoupures || j < depuisCoupures);
      const e = etatJour(c, { panneMin: (panneParJour[j] ?? 0) / 60000, minutesJour, ancien });
      if (e.dispo !== null) {
        cumul.total += minutesJour;
        cumul.ok += minutesJour * e.dispo;
      }
      const info = e.dispo === null
        ? `${dateLisible(j)} · ${e.maintenanceMin ? T.maintenanceSeule(e.maintenanceMin) : premier && j < premier ? T.pasSurveille : T.aucuneDonnee}`
        : [dateLisible(j), T.disponible(pourcent(e.dispo)), e.panneMin && T.panneMin(e.panneMin), e.maintenanceMin && T.maintenanceMin(e.maintenanceMin)]
          .filter(Boolean).join(' · ');
      return `<span class="barre${e.classe ? ` barre--${e.classe}` : ''}" tabindex="0" data-info="${echapper(info)}"></span>`;
    }).join('');
    return `<li class="composant">
      <div class="composant-ligne"><span class="composant-nom">${echapper(nom)}</span><span class="statut statut--${statut}">${echapper(T.statuts[statut] ?? statut)}</span></div>
      <div class="barres" aria-label="${echapper(T.dispoParJour(nom))}">${barres}</div>
      <div class="composant-pied"><span>${debutPied(depuis)}</span><span class="dispo">${cumul.total ? T.disponible(pourcent(cumul.ok / cumul.total)) : ''}</span><span>${T.aujourdhui}</span></div>
    </li>`;
  }).join('');
}

let derniereVerif = null;

function majHeure() {
  $('global-maj').textContent = derniereVerif ? T.derniereVerif(ilYa(derniereVerif)) : '';
}

function afficherGlobal(etat) {
  const g = etat?.global ?? 'inconnu';
  $('global').className = `global global--${g}`;
  $('global-titre').textContent = T.global[g] ?? T.global.inconnu;
  const verif = etat?.verifieA ?? null;
  const nouvelle = derniereVerif !== null && verif !== null && verif !== derniereVerif;
  derniereVerif = verif;
  majHeure();
  if (nouvelle) {
    const el = $('global-maj');
    el.classList.remove('vient-de-changer');
    void el.offsetWidth;
    el.classList.add('vient-de-changer');
  }
}

// Les incidents viennent de l'API publique de GitHub, limitee a 60 appels par
// heure et par adresse : au-dela elle refuse, et la section disparaissait.
// Le dernier resultat lu est garde dans le navigateur et reaffiche a la place.
const CLE_INCIDENTS = 'sentro-statut:incidents:v1';
const SEPT_JOURS = 7 * 86400000;

async function lireGitHub(url) {
  const r = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Signature ajoutee automatiquement par certains outils de publication : elle
// ne doit jamais s'afficher sur la page.
function sansSignature(texte) {
  return texte.replace(/\n*-{3,}\s*\n_?Generated by \[?Claude Code\]?(\([^)]*\))?_?\s*$/i, '').trim();
}

// Source : incidents.json publie par la verification (aux 5 min) ; l'API de
// GitHub seulement si ce fichier manque encore.
async function chargerIncidents() {
  let issues, publies = null;
  try { publies = await lireDonnee('incidents.json'); } catch {}
  if (publies && Array.isArray(publies.issues)) {
    issues = publies.issues;
    commentairesPublies = publies.commentaires ?? null;
  } else {
    issues = (await lireGitHub(`https://api.github.com/repos/${DEPOT}/issues?state=all&per_page=100&sort=created&direction=desc`)).filter(i => !i.pull_request);
  }
  const genre = (i) => i.labels.some(l => l.name === 'maintenance') ? 'maintenance' : i.labels.some(l => l.name === 'incident') ? 'incident' : null;
  const avecSuivis = async i => {
    if (!(i.comments > 0)) return [];
    if (publies?.commentaires) return [...(publies.commentaires[i.number] ?? [])].reverse();
    try { return (await lireGitHub(`https://api.github.com/repos/${DEPOT}/issues/${i.number}/comments`)).reverse(); } catch { return []; }
  };
  // Un incident reste dans « Incidents recents » tant que sa journee est dans
  // le graphique : jusqu'a 90 jours, sur telephone comme sur ordinateur.
  const visibles = Date.now() - JOURS * 86400000;
  const ouverts = issues.filter(i => i.state === 'open' && genre(i));
  const fermes = issues.filter(i => i.state === 'closed' && genre(i) === 'incident' && new Date(i.closed_at).getTime() > visibles && !INCIDENTS_FUSIONNES.has(i.number));
  // Mise a jour publiee sur un incident ferme (explication, correctifs) :
  // affichee en haut de la page pendant 7 jours apres sa publication.
  const aSuivre = fermes.filter(i => i.comments > 0 && new Date(i.updated_at).getTime() > Date.now() - SEPT_JOURS && !EPINGLES_RETIRES.has(i.number));
  const [suivisOuverts, suivisFermes] = await Promise.all([Promise.all(ouverts.map(avecSuivis)), Promise.all(aSuivre.map(avecSuivis))]);
  const champs = (i, suivis) => ({ numero: i.number, genre: genre(i), titre: i.title, texte: (TEXTE_CORRIGE[i.number] ?? (t => t))(i.body ?? ''), creeA: DEBUT_CORRIGE[i.number] ?? i.created_at, fermeA: i.closed_at, nbSuivis: i.comments ?? 0,
    suivis: suivis.map(c => ({ a: c.created_at, texte: texteCommentaire(c) })) });
  return {
    ouverts: ouverts.map((i, n) => champs(i, suivisOuverts[n])),
    epingles: aSuivre.map((i, n) => champs(i, suivisFermes[n]))
      .map(i => ({ ...i, suivis: i.suivis.filter(c => new Date(c.a).getTime() > Date.now() - SEPT_JOURS) }))
      .filter(i => i.suivis.length > 0),
    recents: fermes.map(i => champs(i, [])),
  };
}

function article(i, etiquette, classe) {
  return `<article class="incident incident--${classe}">
      <span class="incident-etiquette">${etiquette}</span>
      <h3>${texteIssue(i.titre)}</h3>
      ${i.texte ? `<p>${texteIssue(i.texte)}</p>` : ''}
      <span class="quand">${T.publie(quand(i.creeA))}</span>
      ${i.suivis.length ? `<ul>${i.suivis.map(c => `<li><time>${quand(c.a)}</time>${texteIssue(c.texte)}</li>`).join('')}</ul>` : ''}
    </article>`;
}

async function afficherIncidents() {
  let donnees = null;
  try {
    donnees = await chargerIncidents();
    try { localStorage.setItem(CLE_INCIDENTS, JSON.stringify(donnees)); } catch {}
  } catch {
    try { donnees = JSON.parse(localStorage.getItem(CLE_INCIDENTS) ?? 'null'); } catch { donnees = null; }
  }
  if (!donnees) return;

  const blocs = [
    ...donnees.ouverts.map(i => article(i, T.etiquette[i.genre === 'maintenance' ? 'maintenance' : 'incident'], i.genre)),
    // Les mises a jour d'un incident resolu ne montrent que ces mises a jour,
    // sous le titre de l'incident (le texte automatique de detection est omis).
    ...(donnees.epingles ?? []).map(i => article({ ...i, texte: '' }, T.miseAJour(quand(i.fermeA)), 'resolu')),
  ];
  $('incidents-en-cours').innerHTML = blocs.join('');
  $('incidents-en-cours').hidden = blocs.length === 0;

  // Pannes rapprochees (moins d'une heure entre la fin de l'une et le debut
  // de la suivante) : une seule ligne, qui ouvre les messages de chacune.
  const groupes = [];
  for (const i of [...donnees.recents].sort((a, b) => new Date(a.creeA) - new Date(b.creeA))) {
    const g = groupes[groupes.length - 1];
    const precedent = g?.[g.length - 1];
    if (precedent && new Date(i.creeA) - new Date(precedent.fermeA) < 3600000) g.push(i); else groupes.push([i]);
  }
  groupes.reverse();
  $('incidents-recents').innerHTML = groupes.map((g, n) => {
    const premier = g[0];
    const moment = g.length === 1 ? quand(premier.creeA) : `${quand(premier.creeA)}${T.et}${g.slice(1).map(i => heure(i.creeA)).join(', ')}`;
    const corrigee = g.map(i => DUREE_GROUPE_CORRIGEE[i.numero]).find(Boolean);
    const durees = corrigee ? T.duree(corrigee) : g.map(i => duree(i.creeA, i.fermeA)).join(T.et);
    return `<li>
    <button type="button" class="recent-bouton" aria-expanded="false" aria-controls="recent-${n}" data-voir="${T.voir}" data-masquer="${T.masquer}" data-numeros="${g.map(i => i.numero).join(',')}">
      <span class="titre">${texteIssue(premier.titre)}</span>
      <span class="quand">${moment} · ${T.resoluEn(durees)}</span>
    </button>
    <div class="recent-details" id="recent-${n}" hidden></div>
  </li>`;
  }).join('');
  $('bloc-recents').hidden = donnees.recents.length === 0;
}

// Correction du 12 novembre 2026 (decision du 15 nov.) : les durees publiees
// (3 min et 14 min, « environ 20 minutes ») comptaient a partir de l'alerte,
// au 2e echec. Les verifications mesurent, du premier echec au premier succes,
// deux coupures (15 h 00 a 15 h 05 et 15 h 11 a 15 h 30) : une seule panne de
// 24 min. Les commentaires GitHub ne sont pas reecrits ici : l'affichage les
// corrige, cle = date du commentaire. La barre du jour vient des coupures
// mesurees (verifier/coupures-mesurees.json).
// Une seule panne pour la journee : l'incident #18 est fusionne dans le #19
// (retire du haut de la page et des incidents recents), qui commence a
// 15 h 00 (premier echec) et dure 24 min.
const INCIDENTS_FUSIONNES = new Set([18]);
// Mises a jour retirees du haut de la page avant la fin de leurs 7 jours
// (l'incident reste dans « Incidents recents »).
const EPINGLES_RETIRES = new Set([19]);
// Version anglaise du message d'explication publie en francais sur le #19
// (commentaire du 2026-11-13T15:14:08Z), avec la duree corrigee (24 minutes).
const EXPLICATION_12_NOVEMBRE_EN = `Explanation and corrective measures

On November 12, the portal was unavailable for 24 minutes. No data was lost: everything that had been saved before the outage was intact when service returned.

What happened: our server received an abnormal volume of traffic, the origin of which could not be confirmed, at the same time as the portal itself was placing a heavy load on the server. Combined, these two factors exceeded its capacity.

What we have fixed since:
• Traffic protection: the portal now goes through a protection service that filters abnormal traffic before it reaches the server.
• A much lighter portal: automatic refresh has been redesigned. An open screen now places 5 to 10 times less load on the server than before, and a background tab or a locked phone barely loads it at all. Messages, notifications and calls still arrive just as quickly.
• More capacity: the server has been doubled, and the portal now runs as 4 copies. If one of them has a problem, it restarts on its own while the others keep serving you.
• Optimized database: the most-used screens now make far fewer queries. The messaging badge, for example, went from 164 queries to 8.
• Stronger monitoring: we now measure load minute by minute and are alerted before a problem affects you. This monitoring has already helped us identify and fix excessive memory use by the hourly backup.

Thank you for your patience. These changes make Sentro more robust for you and for the growth ahead.`;
const DEBUT_CORRIGE = { 19: '2026-11-12T20:00:12Z' };
// Duree corrigee du groupe, en minutes (formatee dans la langue de la page).
const DUREE_GROUPE_CORRIGEE = { 19: 24 };
// Anglais : le texte corrige du 20:30:32Z reste un message automatique
// (traduit a l'affichage) ; les deux autres recoivent leur version anglaise
// ici (separateur ---EN---), les commentaires GitHub ne pouvant etre modifies.
// Panne du 12 novembre mesuree a partir du premier echec (15 h 00).
const TEXTE_CORRIGE = { 19: t => t.replace('Panne détectée à 15 h 16', 'Panne détectée à 15 h 00') };
const COMMENTAIRES_CORRIGES = {
  '2026-11-12T20:05:23Z': t => SentroLangue.bilingue(
    t.replace('Durée de la panne : 3 min.', 'Durée de la panne : 24 min au total, avec la coupure de 15 h 11.'),
    'Restored at 3:05 p.m. Outage duration: 24 min in total, including the 3:11 p.m. interruption.'),
  '2026-11-12T20:30:32Z': t => t.replace('Durée de la panne : 14 min.', 'Durée de la panne : 24 min.'),
  '2026-11-13T15:14:08Z': t => SentroLangue.bilingue(
    t.replace('inaccessible deux fois, à 15 h 01 et à 15 h 16, pendant environ 20 minutes au total', 'inaccessible pendant 24 minutes'),
    EXPLICATION_12_NOVEMBRE_EN),
};
function texteCommentaire(c) {
  const corriger = COMMENTAIRES_CORRIGES[c.created_at];
  const texte = sansSignature(c.body ?? '');
  return corriger ? corriger(texte) : texte;
}

const CLE_SUIVIS = 'sentro-statut:suivis:v1';
// Messages publies dans incidents.json (rempli par chargerIncidents).
let commentairesPublies = null;
async function suivisDe(numero) {
  const publies = commentairesPublies?.[numero];
  if (publies) return publies.map(c => ({ a: c.created_at, texte: texteCommentaire(c) }));
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CLE_SUIVIS) ?? '{}') || {}; } catch {}
  try {
    const suivis = (await lireGitHub(`https://api.github.com/repos/${DEPOT}/issues/${numero}/comments`))
      .map(c => ({ a: c.created_at, texte: texteCommentaire(c) }));
    cache[numero] = suivis;
    try { localStorage.setItem(CLE_SUIVIS, JSON.stringify(cache)); } catch {}
    return suivis;
  } catch {
    return cache[numero] ?? null;
  }
}

document.addEventListener('click', async e => {
  const bouton = e.target.closest('.recent-bouton');
  if (!bouton) return;
  const details = document.getElementById(bouton.getAttribute('aria-controls'));
  const ouvrir = bouton.getAttribute('aria-expanded') !== 'true';
  bouton.setAttribute('aria-expanded', String(ouvrir));
  details.hidden = !ouvrir;
  if (!ouvrir || details.dataset.charge) return;
  details.innerHTML = `<p class="recent-attente">${T.chargement}</p>`;
  const numeros = bouton.dataset.numeros.split(',').map(Number);
  const incidents = (JSON.parse(localStorage.getItem(CLE_INCIDENTS) ?? 'null')?.recents ?? []);
  const blocs = await Promise.all(numeros.map(async numero => {
    const i = incidents.find(x => x.numero === numero);
    const suivis = await suivisDe(numero);
    if (suivis === null) return '';
    return `<div class="recent-message">
      ${i?.texte ? `<p>${texteIssue(i.texte)}</p>` : ''}
      ${suivis.length ? `<ul>${suivis.map(c => `<li><time>${quand(c.a)}</time>${texteIssue(c.texte)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }));
  const contenu = blocs.join('');
  details.innerHTML = contenu || `<p class="recent-attente">${T.messagesIndisponibles}</p>`;
  if (contenu) details.dataset.charge = '1';
});

async function rafraichir() {
  try {
    const [etat, historique] = await Promise.all([lireDonnee('etat.json'), lireDonnee('historique.json')]);
    afficherGlobal(etat);
    afficherServices(etat, historique);
  } catch {
    afficherGlobal(null);
    afficherServices(null, null);
  }
}
const bulle = document.createElement('div');
bulle.className = 'bulle';
bulle.hidden = true;
document.body.appendChild(bulle);
function montrerBulle(e) {
  const b = e.target.closest('.barre');
  if (!b) { bulle.hidden = true; return; }
  const r = b.getBoundingClientRect();
  bulle.textContent = b.dataset.info;
  bulle.hidden = false;
  const x = Math.min(Math.max(r.left + r.width / 2, bulle.offsetWidth / 2 + 8), window.innerWidth - bulle.offsetWidth / 2 - 8);
  bulle.style.left = `${x}px`;
  bulle.style.top = `${r.top}px`;
}
document.addEventListener('mouseover', montrerBulle);
document.addEventListener('focusin', montrerBulle);
document.addEventListener('click', montrerBulle);
document.addEventListener('scroll', () => { bulle.hidden = true; }, { passive: true });

rafraichir();
afficherIncidents();
setInterval(rafraichir, 30000);
setInterval(majHeure, 15000);
setInterval(afficherIncidents, 5 * 60000);
