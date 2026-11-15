// Calcul des pannes affichees sur les barres du jour, partage par la page
// (navigateur : globalThis.SentroCalcul) et par les essais (Node : require).
//
// Regle de la page publique :
// - une coupure dure du PREMIER echec au PREMIER succes qui suit, tels
//   qu'enregistres par la verification ;
// - des coupures separees par moins de REGROUPEMENT_MIN minutes de service
//   retabli forment UNE panne ;
// - une panne n'est comptee (duree, pourcentage, couleur) que si son total
//   atteint PANNE_MIN minutes ; elle compte alors pour sa duree reelle totale ;
// - les journees suivent l'heure de Montreal (America/Toronto, heure avancee
//   comprise) ; une panne a cheval sur minuit est repartie selon l'heure
//   reelle de chaque coupure de part et d'autre de minuit.
(function (racine) {
  const FUSEAU = 'America/Toronto';
  const PANNE_MIN = 15;
  const REGROUPEMENT_MIN = 60;
  const MINUTE = 60000;

  const formatJour = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' });
  const formatEcart = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function jourMontreal(t) {
    return formatJour.format(new Date(t));
  }

  // Ecart (ms) entre l'heure de Montreal et l'heure UTC a l'instant t.
  function ecart(t) {
    const p = Object.fromEntries(formatEcart.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(t / 1000) * 1000;
  }

  // Minuit (heure de Montreal) du jour AAAA-MM-JJ, en ms UTC.
  function minuit(jour) {
    const [a, m, j] = jour.split('-').map(Number);
    const voulu = Date.UTC(a, m - 1, j);
    const premier = voulu - ecart(voulu);
    return voulu - ecart(premier);
  }

  function lendemain(jour) {
    const [a, m, j] = jour.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10);
  }

  // [debut, fin[ du jour a Montreal : 23 h ou 25 h aux changements d'heure.
  function bornesJour(jour) {
    return [minuit(jour), minuit(lendemain(jour))];
  }

  const ms = (x) => (typeof x === 'number' ? x : new Date(x).getTime());

  // coupures : [[debut, fin], ...] (ISO ou ms). Rend les pannes comptees :
  // { debut, fin, dureeMs, coupures: [[debutMs, finMs], ...] }.
  function pannesComptees(coupures, { panneMin = PANNE_MIN, regroupementMin = REGROUPEMENT_MIN } = {}) {
    const triees = (coupures ?? [])
      .map(([d, f]) => [ms(d), ms(f)])
      .filter(([d, f]) => Number.isFinite(d) && Number.isFinite(f) && f > d)
      .sort((x, y) => x[0] - y[0]);
    const groupes = [];
    for (const c of triees) {
      const g = groupes[groupes.length - 1];
      if (g && c[0] - g.fin < regroupementMin * MINUTE) {
        g.coupures.push(c);
        g.fin = Math.max(g.fin, c[1]);
      } else {
        groupes.push({ debut: c[0], fin: c[1], coupures: [c] });
      }
    }
    return groupes
      .map(g => ({ ...g, dureeMs: g.coupures.reduce((s, [d, f]) => s + (f - d), 0) }))
      .filter(g => g.dureeMs >= panneMin * MINUTE);
  }

  // Duree comptee (ms) par jour de Montreal : chaque coupure d'une panne
  // comptee est decoupee aux minuits.
  function pannesParJour(pannes) {
    const parJour = {};
    for (const p of pannes) {
      for (const [d, f] of p.coupures) {
        let debut = d;
        while (debut < f) {
          const jour = jourMontreal(debut);
          const finJour = bornesJour(jour)[1];
          const fin = Math.min(f, finJour);
          parJour[jour] = (parJour[jour] ?? 0) + (fin - debut);
          debut = fin;
        }
      }
    }
    return parJour;
  }

  // Minutes de la journee prises comme base du pourcentage : la journee
  // entiere, ou jusqu'a maintenant pour la journee en cours.
  function minutesSurveillees(jour, maintenant) {
    const [d, f] = bornesJour(jour);
    return Math.max(0, Math.min(f, maintenant) - d) / MINUTE;
  }

  const api = { FUSEAU, PANNE_MIN, REGROUPEMENT_MIN, jourMontreal, bornesJour, pannesComptees, pannesParJour, minutesSurveillees };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.SentroCalcul = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
