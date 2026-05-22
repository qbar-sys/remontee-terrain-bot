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
