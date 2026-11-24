# Sentro Status

https://status.groupesentro.ca

## Incidents

Issue avec l'étiquette `incident` ou `maintenance`. Les commentaires s'affichent comme mises à jour. Fermer l'issue une fois réglé.

## Écrire un incident en deux langues

La page s'affiche en français ou en anglais (langue du navigateur, lien en haut, ou `?lang=en` / `?lang=fr` dans l'adresse).

Dans le texte d'une issue ou d'un commentaire, une ligne seule `---EN---` sépare le français (avant) de l'anglais (après) :

```
Mise à jour du portail le 20 novembre à 23 h 00. Le portail peut être indisponible quelques minutes.
---EN---
Portal update on November 20 at 11:00 p.m. The portal may be unavailable for a few minutes.
```

Titre, sur une ligne : `Mise à jour du portail ---EN--- Portal update`.

Sans séparateur, le texte s'affiche tel quel dans les deux langues. Les messages automatiques de la vérification sont déjà écrits dans les deux langues. Pour une maintenance, l'heure de début est lue dans la partie française (`23 h 00`).

## Secrets

- `SENTRO_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`
- `ALERTE_TEL`
- `STATUT_VU_SECRET` : le même que dans le `.env` du portail (lien « J'ai vu » des textos)

## Alertes

- Panne confirmée : texto avec un lien « J'ai vu » (ou répondre `VU`). Sans « vu » : rappel aux 5 minutes, 12 textos au plus par panne ; après 15 minutes, appel vocal, 3 au plus.
- Plus de 3 redémarrages du portail en 15 minutes : texto, même si le portail répond.
- Essai des secrets Twilio : Actions › Vérification › Run workflow, `test` = `1` (un texto, rien d'autre).

## Deuxième surveillant recommandé

GitHub retarde parfois les tâches planifiées de 10 à 20 minutes. Ajouter un surveillant externe (UptimeRobot ou Better Stack, vérification à la minute) sur `https://<portail>/api/health`, avec texto ou appel.
