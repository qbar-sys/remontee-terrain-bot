// =============================================================================
// Bot Slack – Remontée terrain visites boutiques
// Stack : Slack Bolt (Node.js) + API Notion
// =============================================================================
// Pour démarrer :
//   npm install
//   cp .env.example .env  →  remplir les variables
//   node app.js
// =============================================================================

require("dotenv").config();
const { App } = require("@slack/bolt");
const { Client } = require("@notionhq/client");

// ── Clients ──────────────────────────────────────────────────────────────────

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const NOTION_DB_ID = process.env.NOTION_DATABASE_ID;

// ── État temporaire : associe un fil Slack à une page Notion ─────────────────
// Structure : { [threadTs]: notionPageId }
const pendingPhotos = new Map();

// ── Liste des boutiques ───────────────────────────────────────────────────────

const BOUTIQUES = [
  "Oberkampf", "Saint-Denis", "Saint-Ferdinand", "Pigalle", "Temple",
  "Rambuteau", "Sèvres", "Bac", "Lévis", "Neuilly", "Levallois", "Pompe",
  "Bordeaux Camille Jullian", "Bordeaux Grand-Hommes", "Lille Neuve", "Lille Basse",
];

// ── Définition de la modal Block Kit ─────────────────────────────────────────

function buildModal() {
  return {
    type: "modal",
    callback_id: "remontee_terrain_submit",
    title: { type: "plain_text", text: "Remontée terrain", emoji: true },
    submit: { type: "plain_text", text: "Envoyer", emoji: true },
    close: { type: "plain_text", text: "Annuler", emoji: true },
    blocks: [
      // ── Intro ──────────────────────────────────────────────────────────────
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📋 *Suivi des visites en boutique*\nMerci de fournir le plus de détails possible (aussi bien positifs que négatifs).\n\n👉 <https://app.notion.com/p/thefrenchbastards/Comment-r-aliser-une-remont-e-terrain-388cf3a4784680e981d8f5d547c8256f|Liste des sujets à regarder lors d'un passage en boutique>",
        },
      },

      // ── ⚠️ Avertissement qualité ──────────────────────────────────────────
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⚠️  *Remontées qualité*\nCe formulaire ne concerne *pas* les problèmes qualité produit. Merci de les signaler exclusivement dans le canal dédié au suivi de la qualité.",
        },
      },
      { type: "divider" },

      // ── Q1 : Qui suis-je ──────────────────────────────────────────────────
      {
        type: "input",
        block_id: "block_visiteur",
        label: { type: "plain_text", text: "Qui suis-je ?", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "visiteur",
          placeholder: { type: "plain_text", text: "Votre prénom et nom" },
        },
      },

      // ── Q2 : Boutique ─────────────────────────────────────────────────────
      {
        type: "input",
        block_id: "block_boutique",
        label: { type: "plain_text", text: "Boutique visitée", emoji: true },
        element: {
          type: "static_select",
          action_id: "boutique",
          placeholder: { type: "plain_text", text: "Sélectionner une boutique" },
          options: BOUTIQUES.map((b) => ({
            text: { type: "plain_text", text: b },
            value: b,
          })),
        },
      },

      // ── Q3 : Date ─────────────────────────────────────────────────────────
      {
        type: "input",
        block_id: "block_date",
        label: { type: "plain_text", text: "Date de la visite", emoji: true },
        element: {
          type: "datepicker",
          action_id: "date_visite",
          placeholder: { type: "plain_text", text: "Sélectionner une date" },
        },
      },

      // ── Q4 : Heure ────────────────────────────────────────────────────────
      {
        type: "input",
        block_id: "block_heure",
        label: { type: "plain_text", text: "Heure de la visite", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "heure_visite",
          placeholder: { type: "plain_text", text: "ex. 14:30" },
        },
        hint: { type: "plain_text", text: "Format 24h : HH:MM" },
      },

      // ── Q5 : Points positifs ──────────────────────────────────────────────
      {
        type: "input",
        block_id: "block_positifs",
        optional: true,
        label: { type: "plain_text", text: "✅ Points positifs", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "points_positifs",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Ambiance, merchandising, accueil client, rangement...",
          },
        },
      },

      // ── Q6 : Points d'amélioration ────────────────────────────────────────
      {
        type: "input",
        block_id: "block_amelioration",
        optional: true,
        label: { type: "plain_text", text: "⚠️ Points d'amélioration", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "points_amelioration",
          multiline: true,
          placeholder: { type: "plain_text", text: "Ce qui peut être amélioré..." },
        },
      },

      // ── Q7 : Autres commentaires ──────────────────────────────────────────
      {
        type: "input",
        block_id: "block_commentaires",
        optional: true,
        label: { type: "plain_text", text: "💬 Autres commentaires", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "autres_commentaires",
          multiline: true,
          placeholder: { type: "plain_text", text: "Tout autre retour..." },
        },
      },

      // ── Note photos ───────────────────────────────────────────────────────
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "📸 *Photos* : Après validation, un fil s'ouvrira dans votre messagerie — envoyez-y vos photos (plusieurs autorisées), elles seront ajoutées automatiquement à Notion.",
          },
        ],
      },
    ],
  };
}

// ── Message d'invitation dans le canal ───────────────────────────────────────

function buildInviteMessage() {
  const notionDbUrl = `https://www.notion.so/${NOTION_DB_ID.replace(/-/g, "")}`;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "👋 *Vous revenez d'une visite boutique ?*\nPartagez vos observations en cliquant ci-dessous — cela prend 3 minutes.",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `⚠️ Ce formulaire ne concerne pas les remontées qualité produit — utilisez le canal dédié pour celles-ci.\n📊 <${notionDbUrl}|Consulter l'historique des remontées terrain>`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📋 Remonter une visite", emoji: true },
          style: "primary",
          action_id: "open_remontee_modal",
        },
      ],
    },
  ];
}

// ── Slash command /remontee ───────────────────────────────────────────────────

app.command("/remontee", async ({ command, ack, client, logger }) => {
  await ack();
  try {
    await client.views.open({ trigger_id: command.trigger_id, view: buildModal() });
  } catch (err) {
    logger.error(err);
  }
});

// ── Bouton « Remonter une visite » ────────────────────────────────────────────

app.action("open_remontee_modal", async ({ ack, body, client, logger }) => {
  await ack();
  try {
    await client.views.open({ trigger_id: body.trigger_id, view: buildModal() });
  } catch (err) {
    logger.error(err);
  }
});

// ── Soumission de la modal ────────────────────────────────────────────────────

app.view("remontee_terrain_submit", async ({ ack, body, view, client, logger }) => {
  await ack();

  const v = view.state.values;
  const visiteur     = v.block_visiteur.visiteur.value;
  const boutique     = v.block_boutique.boutique.selected_option?.value;
  const dateVisite   = v.block_date.date_visite.selected_date;
  const heureVisite  = v.block_heure.heure_visite.value;
  const positifs     = v.block_positifs.points_positifs.value || "";
  const amelioration = v.block_amelioration.points_amelioration.value || "";
  const commentaires = v.block_commentaires.autres_commentaires.value || "";
  const userId       = body.user.id;

  try {
    // ── Création de l'entrée Notion ─────────────────────────────────────────
    const notionPage = await notion.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Visiteur:                { title: [{ text: { content: visiteur } }] },
        Boutique:                { select: { name: boutique } },
        "Date de la visite":     { date: { start: dateVisite } },
        "Heure de la visite":    { rich_text: [{ text: { content: heureVisite } }] },
        "Points positifs":       { rich_text: [{ text: { content: positifs } }] },
        "Points d'amélioration": { rich_text: [{ text: { content: amelioration } }] },
        "Autres commentaires":   { rich_text: [{ text: { content: commentaires } }] },
        Statut:                  { select: { name: "Nouveau" } },
      },
    });

    // ── DM de confirmation + ouverture du fil photos ────────────────────────
    const confirmMsg = await client.chat.postMessage({
      channel: userId,
      text: `✅ Remontée enregistrée pour ${boutique} le ${dateVisite} à ${heureVisite}.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *Remontée terrain enregistrée !*\n\n*Boutique :* ${boutique}\n*Date :* ${dateVisite} à ${heureVisite}\n*Visiteur :* ${visiteur}`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `📎 <${notionPage.url}|Voir dans Notion>` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "📸 *Avez-vous des photos ?* Répondez à ce message pour les partager — vous pouvez en envoyer plusieurs. Elles seront automatiquement ajoutées à votre remontée dans Notion.\n\nTapez `ok` ou `non` pour clore le fil sans photo.",
          },
        },
      ],
    });

    // Enregistrer l'association fil → page Notion (expire après 30 min)
    const threadTs = confirmMsg.ts;
    pendingPhotos.set(threadTs, notionPage.id);
    setTimeout(() => pendingPhotos.delete(threadTs), 30 * 60 * 1000);

    // ── Post dans le canal de suivi ─────────────────────────────────────────
    if (process.env.SLACK_RECAP_CHANNEL) {
      await client.chat.postMessage({
        channel: process.env.SLACK_RECAP_CHANNEL,
        text: `Nouvelle remontée terrain réalisée à ${boutique} par ${visiteur}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📍 Nouvelle remontée terrain réalisée à *${boutique}* par *${visiteur}* le ${dateVisite} à ${heureVisite}.\n\n<${notionPage.url}|Pour en savoir plus →>`,
            },
          },
        ],
      });
    }
  } catch (err) {
    logger.error("Erreur Notion :", err);
    await client.chat.postMessage({
      channel: userId,
      text: "❌ Erreur lors de l'enregistrement. Merci de réessayer ou de contacter un admin.",
    });
  }
});

// ── Écoute des photos dans le fil de confirmation ─────────────────────────────
// L'utilisateur répond dans le DM de confirmation avec une ou plusieurs photos.
// Le bot met à jour l'entrée Notion avec les liens Slack de chaque fichier.

app.event("message", async ({ event, client, logger }) => {
  // On ne traite que les réponses dans un fil (thread_reply) contenant des fichiers
  if (!event.thread_ts || !event.files || event.files.length === 0) return;
  // Ignorer les messages du bot lui-même
  if (event.bot_id) return;

  const notionPageId = pendingPhotos.get(event.thread_ts);
  if (!notionPageId) return;

  try {
    // Construire des rich_text Notion avec liens cliquables (un par photo)
    const newPhotoRichText = event.files.flatMap((f, i) => {
      const entry = [
        {
          type: "text",
          text: { content: f.name || "Photo", link: { url: f.permalink } },
        },
      ];
      // Séparateur entre photos du même envoi
      if (i < event.files.length - 1) {
        entry.push({ type: "text", text: { content: "\n" } });
      }
      return entry;
    });

    // Lire les photos existantes pour les conserver (plusieurs envois successifs)
    const existingPage = await notion.pages.retrieve({ page_id: notionPageId });
    const existingRichText = existingPage.properties["Photos"]?.rich_text || [];

    // Ajouter un saut de ligne entre les envois successifs
    const separator = existingRichText.length > 0
      ? [{ type: "text", text: { content: "\n" } }]
      : [];

    const allPhotos = [...existingRichText, ...separator, ...newPhotoRichText];

    // Mise à jour de la page Notion
    await notion.pages.update({
      page_id: notionPageId,
      properties: {
        Photos: { rich_text: allPhotos },
      },
    });

    const count = event.files.length;
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts,
      text: `📎 ${count} photo${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""} à la remontée dans Notion. Vous pouvez en envoyer d'autres ou continuer.`,
    });
  } catch (err) {
    logger.error("Erreur ajout photos Notion :", err);
  }
});

// ── Commande pour poster le message d'invitation dans un canal ────────────────

app.command("/remontee-invite", async ({ command, ack, client, logger }) => {
  await ack();
  try {
    await client.chat.postMessage({
      channel: command.channel_id,
      text: "Remontée terrain",
      blocks: buildInviteMessage(),
    });
  } catch (err) {
    logger.error(err);
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────

(async () => {
  await app.start();
  console.log("⚡️ Bot Remontée terrain démarré (Socket Mode)");
})();
