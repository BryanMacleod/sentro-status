const DEPOT = 'BryanMacleod/sentro-status';
const DONNEES = `https://raw.githubusercontent.com/${DEPOT}/donnees`;
const CONTENU = `https://api.github.com/repos/${DEPOT}/contents`;
const JOURS = 90;
const FUSEAU = 'America/Toronto';

const COMPOSANTS = [
  { id: 'portail', nom: 'Portail web' },
  { id: 'connexion', nom: 'Connexion' },
  { id: 'base', nom: 'Base de données' },
  { id: 'courriels', nom: 'Courriels' },
  { id: 'notifications', nom: 'Notifications' },
  { id: 'stockage', nom: 'Stockage des fichiers' },
  { id: 'sauvegardes', nom: 'Sauvegardes' },
  { id: 'taches', nom: 'Tâches planifiées' },
];

const LIBELLES = {
  operationnel: 'Opérationnel',
  degrade: 'Perturbé',
  panne: 'En panne',
  inconnu: 'En attente',
};

const GLOBAL = {
  operationnel: 'Tous les services fonctionnent',
  degrade: 'Perturbation en cours',
  panne: 'Panne en cours',
  inconnu: 'État indisponible',
};

const $ = (id) => document.getElementById(id);

function echapper(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function texteIssue(s) {
  return echapper(String(s ?? '').replace(/(^|\s)@[\w-]+/g, '$1').replace(/\r/g, '').trim());
}

function jourQuebec(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function dateLisible(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, j)));
}
function dateCourte(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  const autreAnnee = a !== Number(jourQuebec(new Date()).slice(0, 4));
  const texte = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', ...(autreAnnee ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, j)));
  return j === 1 ? texte.replace(/^1 /, '1er ') : texte;
}

function quand(iso) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function ilYa(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`;
}

function duree(debutIso, finIso) {
  const min = Math.max(1, Math.round((new Date(finIso) - new Date(debutIso)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
function derniersJours() {
  const [a, m, j] = jourQuebec(new Date()).split('-').map(Number);
  const jours = [];
  for (let i = JOURS - 1; i >= 0; i--) jours.push(new Date(Date.UTC(a, m - 1, j - i)).toISOString().slice(0, 10));
  return jours;
}

function etatJour(c) {
  if (!c) return { classe: '', dispo: null, panneMin: 0 };
  const total = (c.operationnel ?? 0) + (c.degrade ?? 0) + (c.panne ?? 0);
  if (total === 0) return { classe: '', dispo: null, panneMin: 0 };
  const ratio = (c.panne ?? 0) / total;
  const classe = ratio >= 0.05 ? 'panne' : (c.panne ?? 0) > 0 || (c.degrade ?? 0) > 0 ? 'degrade' : 'operationnel';
  return { classe, dispo: 1 - ratio, panneMin: (c.panne ?? 0) * 5 };
}

function pourcent(x) {
  return `${(Math.floor(x * 10000) / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
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
  const periode = derniersJours();
  const debutCourt = periode[periode.length - 30];
  const premier = Object.keys(historique?.jours ?? {}).sort()[0];
  const depuisLong = premier && premier > periode[0] ? premier : null;
  const depuisCourt = premier && premier > debutCourt ? premier : null;
  const libelle = (depuis, plein) => depuis ? `Surveillé depuis le ${dateCourte(depuis)}` : plein;
  $('legende').innerHTML = `<span class="periode-longue">${libelle(depuisLong, `${JOURS} derniers jours`)}</span><span class="periode-courte">${libelle(depuisCourt, '30 derniers jours')}</span>`;

  $('composants').innerHTML = COMPOSANTS.map(({ id, nom }) => {
    const statut = etat?.composants?.[id]?.statut ?? 'inconnu';
    const long = { ok: 0, total: 0 }, court = { ok: 0, total: 0 };
    const barres = periode.map(j => {
      const c = historique?.jours?.[j]?.[id];
      const e = etatJour(c);
      const recent = j >= debutCourt;
      if (c) {
        const t = (c.operationnel ?? 0) + (c.degrade ?? 0) + (c.panne ?? 0);
        for (const p of recent ? [long, court] : [long]) { p.total += t; p.ok += t - (c.panne ?? 0); }
      }
      const info = e.dispo === null
        ? `${dateLisible(j)} · ${premier && j < premier ? 'Pas encore surveillé' : 'Aucune donnée'}`
        : `${dateLisible(j)} · ${pourcent(e.dispo)} disponible${e.panneMin ? ` · environ ${e.panneMin} min de panne` : ''}`;
      return `<span class="barre${e.classe ? ` barre--${e.classe}` : ''}${recent ? '' : ' barre--ancienne'}" tabindex="0" data-info="${echapper(info)}"></span>`;
    }).join('');
    return `<li class="composant">
      <div class="composant-ligne"><span class="composant-nom">${echapper(nom)}</span><span class="statut statut--${statut}">${LIBELLES[statut] ?? statut}</span></div>
      <div class="barres" aria-label="Disponibilité de ${echapper(nom)} par jour">${barres}</div>
      <div class="composant-pied"><span><span class="periode-longue">Il y a ${JOURS} jours</span><span class="periode-courte">Il y a 30 jours</span></span><span class="dispo"><span class="periode-longue">${long.total ? `${pourcent(long.ok / long.total)} disponible` : ''}</span><span class="periode-courte">${court.total ? `${pourcent(court.ok / court.total)} disponible` : ''}</span></span><span>Aujourd'hui</span></div>
    </li>`;
  }).join('');
}

let derniereVerif = null;

function majHeure() {
  $('global-maj').textContent = derniereVerif ? `Dernière vérification ${ilYa(derniereVerif)}` : '';
}

function afficherGlobal(etat) {
  const g = etat?.global ?? 'inconnu';
  $('global').className = `global global--${g}`;
  $('global-titre').textContent = GLOBAL[g] ?? GLOBAL.inconnu;
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

async function afficherIncidents() {
  let issues;
  try {
    const r = await fetch(`https://api.github.com/repos/${DEPOT}/issues?state=all&per_page=40&sort=created&direction=desc`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    issues = (await r.json()).filter(i => !i.pull_request);
  } catch { return; }

  const genre = (i) => i.labels.some(l => l.name === 'maintenance') ? 'maintenance' : i.labels.some(l => l.name === 'incident') ? 'incident' : null;
  const ouverts = issues.filter(i => i.state === 'open' && genre(i));
  const quinzeJours = Date.now() - 15 * 86400000;
  const recents = issues.filter(i => i.state === 'closed' && genre(i) === 'incident' && new Date(i.closed_at).getTime() > quinzeJours);

  const blocs = await Promise.all(ouverts.map(async i => {
    let suivis = [];
    if (i.comments > 0) {
      try {
        const r = await fetch(i.comments_url, { headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) suivis = (await r.json()).reverse();
      } catch {}
    }
    const g = genre(i);
    return `<article class="incident incident--${g}">
      <span class="incident-etiquette">${g === 'maintenance' ? 'Maintenance' : 'Incident'}</span>
      <h3>${texteIssue(i.title)}</h3>
      ${i.body ? `<p>${texteIssue(i.body)}</p>` : ''}
      <span class="quand">Publié le ${quand(i.created_at)}</span>
      ${suivis.length ? `<ul>${suivis.map(c => `<li><time>${quand(c.created_at)}</time>${texteIssue(c.body)}</li>`).join('')}</ul>` : ''}
    </article>`;
  }));
  $('incidents-en-cours').innerHTML = blocs.join('');
  $('incidents-en-cours').hidden = blocs.length === 0;

  $('incidents-recents').innerHTML = recents.map(i => `<li>
    <span class="titre">${texteIssue(i.title)}</span>
    <span class="quand">${quand(i.created_at)} · résolu en ${duree(i.created_at, i.closed_at)}</span>
  </li>`).join('');
  $('bloc-recents').hidden = recents.length === 0;
}

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
