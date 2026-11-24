// Langue de la page d'etat (francais ou anglais), partagee par la page
// (navigateur : globalThis.SentroLangue), la verification et les essais
// (Node : require). Tout le texte affiche est dans TEXTES : un seul dictionnaire.
//
// Choix de la langue : ?lang=en|fr dans l'adresse, sinon le choix memorise
// (lien en haut de la page), sinon anglais si la langue du navigateur commence
// par « en », francais autrement.
//
// Textes des incidents (issues et commentaires GitHub) :
// - une ligne seule « ---EN--- » separe le francais (avant) de l'anglais
//   (apres) ; dans un titre, sur une seule ligne : « Titre ---EN--- Title » ;
// - sans separateur, les messages automatiques de verifier.mjs sont reconnus
//   et traduits a l'affichage ; tout autre texte reste tel quel.
(function (racine) {
  const SEPARATEUR = '---EN---';
  const FUSEAU = 'America/Toronto';
  const LANGUES = ['fr', 'en'];

  const COMPOSANTS = {
    portail: { fr: 'Portail web', en: 'Web portal' },
    connexion: { fr: 'Connexion', en: 'Sign-in' },
    base: { fr: 'Base de données', en: 'Database' },
    courriels: { fr: 'Courriels', en: 'Email' },
    notifications: { fr: 'Notifications', en: 'Notifications' },
    stockage: { fr: 'Stockage des fichiers', en: 'File storage' },
    sauvegardes: { fr: 'Sauvegardes', en: 'Backups' },
    restauration: { fr: 'Test de restauration', en: 'Restore test' },
    taches: { fr: 'Tâches planifiées', en: 'Scheduled tasks' },
  };

  const format = (code, options) => new Intl.DateTimeFormat(code, options);

  const TEXTES = {
    fr: {
      code: 'fr-CA',
      autre: 'en',
      nomAutre: 'English',
      titrePage: 'État des services Sentro',
      description: 'État en temps réel des services Sentro et historique de disponibilité.',
      sousTitre: 'État des services',
      chargement: 'Chargement…',
      services: 'Services',
      recents: 'Incidents récents',
      pied: "Vérifié toutes les 5 minutes depuis l'extérieur de nos serveurs.",
      statuts: { operationnel: 'Opérationnel', degrade: 'Perturbé', panne: 'En panne', inconnu: 'En attente', maintenance: 'Maintenance' },
      global: { operationnel: 'Tous les services fonctionnent', degrade: 'Perturbation en cours', panne: 'Panne en cours', inconnu: 'État indisponible', maintenance: 'Maintenance en cours' },
      jours: n => (n === 1 ? '1 jour' : `${n} jours`),
      derniersJours: n => `${n} derniers jours`,
      surveilleDepuis: j => `Surveillé depuis ${j}`,
      ilYaJours: j => `Il y a ${j}`,
      aujourdhui: "Aujourd'hui",
      nombre: x => x.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      pourcent: n => `${n} %`,
      disponible: p => `${p} disponible`,
      panneMin: m => `environ ${m} min de panne`,
      perturbeMin: m => `perturbé environ ${m} min`,
      maintenanceMin: m => `maintenance environ ${m} min`,
      maintenanceSeule: m => `Maintenance environ ${m} min`,
      pasSurveille: 'Pas encore surveillé',
      aucuneDonnee: 'Aucune donnée',
      dispoParJour: nom => `Disponibilité de ${nom} par jour`,
      derniereVerif: quand => `Dernière vérification ${quand}`,
      ilYa: min => {
        if (min < 1) return "à l'instant";
        if (min < 60) return `il y a ${min} min`;
        const h = Math.floor(min / 60);
        return h < 24 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`;
      },
      duree: min => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`),
      etiquette: { incident: 'Incident', maintenance: 'Maintenance' },
      miseAJour: q => `Mise à jour · résolu le ${q}`,
      publie: q => `Publié le ${q}`,
      et: ' et ',
      resoluEn: d => `résolu en ${d}`,
      voir: 'Voir le message',
      masquer: 'Masquer le message',
      messagesIndisponibles: 'Messages indisponibles pour le moment.',
      formats: {
        date: format('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
        quand: format('fr-CA', { timeZone: FUSEAU, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
        heure: format('fr-CA', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }),
        heureUtc: format('fr-CA', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }),
      },
    },
    en: {
      code: 'en-CA',
      autre: 'fr',
      nomAutre: 'Français',
      titrePage: 'Sentro Service Status',
      description: 'Real-time status of Sentro services and uptime history.',
      sousTitre: 'Service status',
      chargement: 'Loading…',
      services: 'Services',
      recents: 'Recent incidents',
      pied: 'Checked every 5 minutes from outside our servers.',
      statuts: { operationnel: 'Operational', degrade: 'Degraded', panne: 'Outage', inconnu: 'Pending', maintenance: 'Maintenance' },
      global: { operationnel: 'All systems operational', degrade: 'Degraded performance', panne: 'Outage in progress', inconnu: 'Status unavailable', maintenance: 'Maintenance in progress' },
      jours: n => (n === 1 ? '1 day' : `${n} days`),
      derniersJours: n => `Last ${n} days`,
      surveilleDepuis: j => `Monitored for ${j}`,
      ilYaJours: j => `${j} ago`,
      aujourdhui: 'Today',
      nombre: x => x.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      pourcent: n => `${n}%`,
      disponible: p => `${p} uptime`,
      panneMin: m => `about ${m} min of downtime`,
      perturbeMin: m => `degraded for about ${m} min`,
      maintenanceMin: m => `about ${m} min of maintenance`,
      maintenanceSeule: m => `About ${m} min of maintenance`,
      pasSurveille: 'Not yet monitored',
      aucuneDonnee: 'No data',
      dispoParJour: nom => `Daily uptime for ${nom}`,
      derniereVerif: quand => `Last checked ${quand}`,
      ilYa: min => {
        if (min < 1) return 'just now';
        if (min < 60) return `${min} min ago`;
        const h = Math.floor(min / 60);
        if (h < 24) return `${h} hr ago`;
        const j = Math.floor(h / 24);
        return j === 1 ? '1 day ago' : `${j} days ago`;
      },
      duree: min => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} hr${min % 60 ? ` ${min % 60} min` : ''}`),
      etiquette: { incident: 'Incident', maintenance: 'Maintenance' },
      miseAJour: q => `Update · resolved ${q}`,
      publie: q => `Posted ${q}`,
      et: ' and ',
      resoluEn: d => `resolved in ${d}`,
      voir: 'View message',
      masquer: 'Hide message',
      messagesIndisponibles: 'Messages unavailable right now.',
      formats: {
        date: format('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
        quand: format('en-CA', { timeZone: FUSEAU, day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }),
        heure: format('en-CA', { timeZone: FUSEAU, hour: 'numeric', minute: '2-digit' }),
        heureUtc: format('en-CA', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }),
      },
    },
  };

  const valide = l => (LANGUES.includes(l) ? l : null);

  // parametre : ?lang= ; memorisee : choix du lien ; navigateur : navigator.languages.
  function choisirLangue({ parametre = null, memorisee = null, navigateur = [] } = {}) {
    const p = valide(String(parametre ?? '').toLowerCase());
    if (p) return p;
    const m = valide(memorisee);
    if (m) return m;
    const premiere = String((Array.isArray(navigateur) ? navigateur[0] : navigateur) ?? '').toLowerCase();
    return premiere.startsWith('en') ? 'en' : 'fr';
  }

  function textes(langue) {
    return TEXTES[valide(langue) ?? 'fr'];
  }

  // Dates et nombres -------------------------------------------------------
  const dateLisible = (jour, langue) => {
    const [a, m, j] = jour.split('-').map(Number);
    return textes(langue).formats.date.format(new Date(Date.UTC(a, m - 1, j)));
  };
  const quand = (iso, langue) => textes(langue).formats.quand.format(new Date(iso));
  const heure = (iso, langue) => textes(langue).formats.heure.format(new Date(iso));
  // Pourcentage tronque a 2 decimales (99,999 % ne s'affiche pas 100 %).
  const pourcent = (x, langue) => {
    const t = textes(langue);
    return t.pourcent(t.nombre(Math.floor(x * 10000) / 100));
  };

  // Separateur -------------------------------------------------------------
  const ligneSeparateur = new RegExp(`^[ \\t]*${SEPARATEUR}[ \\t]*$`, 'm');
  const separateurTitre = new RegExp(`\\s*${SEPARATEUR}\\s*`);

  // Partie du texte dans la langue voulue, ou null s'il n'y a pas de separateur.
  function partie(texte, langue) {
    const s = String(texte ?? '').replace(/\r/g, '');
    const m = ligneSeparateur.exec(s) ?? (s.includes('\n') ? null : separateurTitre.exec(s));
    if (!m) return null;
    return (langue === 'en' ? s.slice(m.index + m[0].length) : s.slice(0, m.index)).trim();
  }

  // Messages automatiques (verifier.mjs) -----------------------------------
  const HEURE = '(\\d{1,2})\\s*h\\s*(\\d{2})';
  const DUREE = '(\\d+\\s*min|\\d+\\s*h\\s*\\d{2})';
  const NOMS_FR = Object.fromEntries(Object.values(COMPOSANTS).map(c => [c.fr, c.en]));

  // « 3:30 p.m. » termine deja la phrase : pas de second point.
  const finPhrase = t => (t.endsWith('.') ? t : `${t}.`);
  const heureEn = (h, m) => TEXTES.en.formats.heureUtc.format(new Date(Date.UTC(2000, 0, 1, Number(h), Number(m))));
  function dureeEn(texte) {
    const h = /^(\d+)\s*h\s*(\d{2})$/.exec(texte.trim());
    const min = h ? Number(h[1]) * 60 + Number(h[2]) : Number(/^(\d+)/.exec(texte.trim())[1]);
    return TEXTES.en.duree(min);
  }
  // « Portail web, Connexion » -> « Web portal, Sign-in », ou null si un nom est inconnu.
  function nomsEn(liste) {
    const noms = liste.split(',').map(n => n.trim());
    if (noms.some(n => !NOMS_FR[n])) return null;
    return noms.map(n => NOMS_FR[n]).join(', ');
  }

  const FORMES = [
    [new RegExp(`^Panne\\s*:\\s*(.+)$`), (m) => { const n = nomsEn(m[1]); return n && `Outage: ${n}`; }],
    [new RegExp(`^Panne détectée à ${HEURE} \\(heure du Québec\\) par la vérification automatique\\.\\s*Services touchés\\s*:\\s*(.+?)\\.$`, 's'),
      (m) => { const n = nomsEn(m[3]); return n && `Outage detected at ${heureEn(m[1], m[2])} (Eastern Time) by automated monitoring.\n\nAffected services: ${n}.`; }],
    [new RegExp(`^Rétabli à ${HEURE}\\.\\s*Durée de la panne\\s*:\\s*${DUREE}\\.$`), (m) => `Restored at ${finPhrase(heureEn(m[1], m[2]))} Outage duration: ${dureeEn(m[3])}.`],
    [new RegExp(`^${HEURE}\\s*:\\s*aussi en panne\\s*:\\s*(.+)\\.$`), (m) => { const n = nomsEn(m[3]); return n && `${heureEn(m[1], m[2])}: also down: ${n}.`; }],
    [new RegExp(`^${HEURE}\\s*:\\s*rétabli\\s*:\\s*(.+)\\.$`), (m) => { const n = nomsEn(m[3]); return n && `${heureEn(m[1], m[2])}: restored: ${n}.`; }],
  ];

  // Traduction anglaise d'un message automatique, ou null s'il n'en est pas un.
  function traduireAuto(texte) {
    const s = String(texte ?? '').replace(/\r/g, '').replace(/(^|\s)@[\w-]+/g, '$1').trim();
    for (const [forme, traduire] of FORMES) {
      const m = forme.exec(s);
      if (m) return traduire(m) || null;
    }
    return null;
  }

  // Texte d'une issue ou d'un commentaire dans la langue de la page.
  function localiser(texte, langue) {
    const brut = String(texte ?? '');
    const p = partie(brut, langue);
    if (p !== null) return p;
    return (langue === 'en' && traduireAuto(brut)) || brut;
  }

  // Message en deux langues, pour verifier.mjs et les corrections.
  const bilingue = (fr, en) => `${fr}\n\n${SEPARATEUR}\n\n${en}`;

  const api = { SEPARATEUR, FUSEAU, LANGUES, COMPOSANTS, TEXTES, choisirLangue, textes, dateLisible, quand, heure, pourcent, partie, traduireAuto, localiser, bilingue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.SentroLangue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
