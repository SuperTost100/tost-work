/** The built-in guides in Italian, by the guide's folder name. The guides' own files stay English: the agent reads those. */
export type GuideIt = { title: string; description: string; steps: string };

/**
 * The steps are the guide's SKILL.md body without its first heading, as the Skills screen shows them. Code blocks,
 * commands and file names are the English guide's, word for word.
 */
export const GUIDES_IT: Record<string, GuideIt> = {
  excel: {
    title: "Fogli Excel",
    description:
      "Crea o modifica un file Excel (.xlsx) con formule che funzionano, una formattazione leggibile e nessun errore. Serve per budget, listini, preventivi, calendari, schede di controllo e ogni altra tabella di numeri.",
    steps: `Una cartella di lavoro è qualcosa su cui l'utente continuerà a lavorare, quindi i totali devono essere formule e l'impaginazione deve essere chiara. Crea il file con il comando \`officecli\`, mai scrivendo tu stesso l'XML.

\`officecli help xlsx <element>\` elenca tutte le proprietà di un elemento, per esempio \`officecli help xlsx cell\` o \`officecli help xlsx column\`.

## Una nuova cartella di lavoro

1. Decidi i fogli e, per ciascuno, le colonne. Una tabella per foglio, che parte da A1, con una sola riga di intestazione.
2. Crea il file e riempilo. \`batch\` scrive molte celle con un solo salvataggio:

   \`\`\`bash
   officecli create "Preventivo.xlsx"
   echo '[
     {"command":"set","path":"/Sheet1/A1","props":{"value":"Fase","bold":"true"}},
     {"command":"set","path":"/Sheet1/B1","props":{"value":"Giorni","bold":"true"}},
     {"command":"set","path":"/Sheet1/C1","props":{"value":"Tariffa","bold":"true"}},
     {"command":"set","path":"/Sheet1/D1","props":{"value":"Totale","bold":"true"}},
     {"command":"set","path":"/Sheet1/A2","props":{"value":"Analisi"}},
     {"command":"set","path":"/Sheet1/B2","props":{"value":"4"}},
     {"command":"set","path":"/Sheet1/C2","props":{"value":"600"}},
     {"command":"set","path":"/Sheet1/D2","props":{"formula":"B2*C2"}}
   ]' | officecli batch "Preventivo.xlsx" --json
   \`\`\`

3. Dai ai fogli il nome di ciò che contengono: \`officecli set "Preventivo.xlsx" /Sheet1 --prop name=Preventivo\`.
4. Blocca la riga di intestazione perché resti visibile: \`--prop freeze=A2\` sul foglio.
5. Formatta i numeri, per esempio \`--prop numFmt='#,##0.00'\` su un intervallo di importi, o un formato in euro per i prezzi.
6. Imposta l'autore e un titolo su \`/\`, come in Word: \`--prop author="…" --prop title="…"\`.

## Regole per i numeri

- Ogni totale, subtotale, percentuale o valore derivato è una formula (\`SUM\`, \`B2*C2\`), mai un numero che hai calcolato tu. L'utente cambierà i dati di partenza e si aspetterà che i totali li seguano.
- Metti ogni ipotesi, come una tariffa giornaliera o un'aliquota IVA, in una cella a sé con la sua etichetta, e fai puntare le formule a quella cella invece di ripetere il numero.
- Tieni le unità di misura nell'intestazione ("Prezzo (€)"), non nelle celle, così le celle restano numeri.

## Modificare una cartella di lavoro già esistente

- Chiedi con \`request_approval\` prima di modificare un file che esisteva prima dell'attività.
- Cambia solo le celle di cui l'utente ha parlato. Mantieni la loro formattazione, le formule e gli altri fogli.
- Leggi prima di scrivere: \`officecli get <file> /Sheet1/A1:F20\` mostra valori e formule.

## Prima di finire

1. \`officecli validate <file>\` deve dire che non ci sono errori.
2. Rileggi con \`get\` i risultati delle formule e confrontali con i numeri che ti aspetti. Nessuna cella deve mostrare \`#REF!\`, \`#DIV/0!\`, \`#NAME?\` o \`#VALUE!\`.

Non eseguire \`officecli view <file> issues\` su una cartella di lavoro: può bloccarsi su una formula che fa riferimento a se stessa.`,
  },
  pdf: {
    title: "File PDF",
    description:
      "Crea un PDF che si può inviare o stampare. Serve quando l'utente chiede un PDF, una copia definitiva, qualcosa da inviare che non deve essere modificato, o la versione stampabile di un file Word, Excel o PowerPoint.",
    steps: `Un PDF è una copia definitiva: la gente lo invia, lo stampa e non lo modifica. Tost Work crea i PDF a partire da file Word, Excel e PowerPoint con il suo strumento \`make_pdf\`, quindi non devi mai scrivere codice PDF.

## Creare un PDF

1. Crea prima il contenuto come file Office adatto, seguendo la guida Word, Excel o PowerPoint: un documento come \`.docx\`, una tabella come \`.xlsx\`, delle slide come \`.pptx\`.
2. Controlla quel file come dice la sua guida, perché il PDF mostra esattamente ciò che contiene.
3. Chiama \`make_pdf\` con il percorso completo del file. Tost Work salva il PDF accanto al file, con lo stesso nome, e ti dice il suo percorso. Se esiste già un PDF con quel nome, il nuovo riceve un numero invece di sostituirlo.
4. Di' all'utente dov'è il PDF. Lascia lì anche il file Office: è la copia che può ancora modificare.

Per il PDF di un file che l'utente ti ha dato, chiama \`make_pdf\` direttamente su quel file.

## Da sapere

- Le pagine Word mantengono le dimensioni, ogni slide diventa una pagina e una cartella di lavoro si stampa su pagine A4.
- I font che arrivano con Office, come Calibri e Cambria, vengono sostituiti da font con le stesse larghezze di lettera, così le righe vanno a capo dove andrebbero a capo in Word.
- Non creare un PDF se l'utente non l'ha chiesto: il file Office modificabile è l'impostazione predefinita.`,
  },
  powerpoint: {
    title: "Presentazioni PowerPoint",
    description:
      "Crea o modifica una presentazione PowerPoint (.pptx) con diapositive chiare, che si apre in PowerPoint senza richieste di riparazione. Serve per presentazioni commerciali, slide di un corso, riunioni e ogni altra presentazione di lavoro.",
    steps: `Una presentazione si legge da lontano, in una sala, o si scorre in fretta durante una riunione. Crea il file con il comando \`officecli\`, mai scrivendo tu stesso l'XML.

\`officecli help pptx <element>\` elenca tutte le proprietà di un elemento, per esempio \`officecli help pptx slide\` o \`officecli help pptx shape\`.

## Una nuova presentazione

1. Pianifica prima la storia: un'idea per slide, e titoli che dicano il punto ("I tempi scendono da due giorni a quattro ore"), non solo l'argomento ("Tempi").
2. Crea il file, poi aggiungi le slide una alla volta:

   \`\`\`bash
   officecli create "Corso AI.pptx"
   officecli add "Corso AI.pptx" / --type slide --prop layout="Title Slide" --prop title="Corso AI per Città Studi"
   officecli add "Corso AI.pptx" / --type slide --prop layout="Title and Content" --prop title="Tre incontri da tre ore" --prop text="$(printf 'Modelli e strumenti\\nLavorare sui propri file\\nLa prima skill')"
   \`\`\`

3. Usa solo questi nomi di layout: \`Title Slide\`, \`Title and Content\`, \`Two Content\`, \`Title Only\`, \`Blank\`. Qualsiasi altro nome fallisce e può lasciare una slide rotta, quindi dopo un \`add\` fallito esegui \`validate\` e rimuovi ciò che ha lasciato.
4. Imposta l'autore e un titolo su \`/\`: \`--prop author="…" --prop title="…"\`.

## Scrivere le slide

- Al massimo sei punti elenco per slide e circa dieci parole per punto. Sposta i dettagli nelle note del relatore o in un documento.
- Ogni slide ha un titolo. Usa lo stesso layout per le slide dello stesso tipo.
- I numeri vanno in una tabella o in un grafico, non in un paragrafo.
- Scrivi nella lingua dell'utente, con la sua tipografia.

## Modificare una presentazione già esistente

- Chiedi con \`request_approval\` prima di modificare un file che esisteva prima dell'attività.
- Mantieni il tema, i layout e l'ordine delle slide dell'utente, a meno che non abbia chiesto di cambiarli. Sostituisci il testo sul posto con \`set … --find … --replace …\`.
- Non duplicare né clonare slide che contengono grafici, gruppi o video: l'OfficeCLI attuale può produrre un file che PowerPoint vuole riparare. Crea invece una nuova slide.

## Prima di finire

1. \`officecli validate <file>\` deve dire che non ci sono errori.
2. \`officecli view <file> outline\` elenca le slide con i loro titoli: controlla che raccontino la storia nell'ordine giusto.
3. \`officecli view <file> text\` ti permette di rileggere ogni slide per cercare errori e testi troppo lunghi.`,
  },
  word: {
    title: "Documenti Word",
    description:
      "Crea o modifica un documento Word (.docx) dall'aspetto professionale, che si apre in Word senza avvisi. Serve per relazioni, proposte, lettere, appunti, verbali, scalette e ogni altro documento di lavoro.",
    steps: `Chi lavora in azienda si aspetta un file Word che può aprire, modificare e inviare. Crealo con il comando \`officecli\`, mai scrivendo tu stesso l'XML del file, e non consegnare mai un file \`.txt\` o \`.md\` al suo posto.

\`officecli help docx <element>\` elenca tutte le proprietà di un elemento. Guarda lì invece di indovinare un nome.

## Un nuovo documento

1. Pianifica prima la struttura: un titolo, un'apertura breve che dice a cosa serve il documento, poi le sezioni con i loro titoli. Chi legge deve capire il punto guardando solo i titoli.
2. Crea il file e scrivi il contenuto in Markdown in un solo passaggio. I titoli diventano i veri stili di titolo di Word, gli elenchi diventano elenchi di Word e le tabelle ricevono una riga di intestazione che si ripete in ogni pagina:

   \`\`\`bash
   officecli create "Proposta Alpi Logistica.docx"
   officecli add "Proposta Alpi Logistica.docx" /body --type markdown --prop markdown="$(cat <<'MD'
   # Proposta per Alpi Logistica

   Questa proposta descrive come ridurre i tempi delle offerte.

   ## Obiettivi

   - Offerte standard pronte in meno di quattro ore
   - Nessun cambio ai gestionali in uso

   ## Tempi e costi

   | Fase | Durata | Prezzo |
   |---|---|---|
   | Analisi | 1 settimana | € 2.400 |
   MD
   )"
   \`\`\`

   Usa l'heredoc tra apici come mostrato (\`<<'MD'\`), così gli apostrofi e i simboli nel testo non hanno bisogno di escape.
3. Imposta l'autore, che Tost Work ti indica nelle sue istruzioni, e un titolo:

   \`\`\`bash
   officecli set "Proposta Alpi Logistica.docx" / --prop author="Giulia Rossi" --prop lastModifiedBy="Giulia Rossi" --prop title="Proposta per Alpi Logistica"
   \`\`\`

4. Con \`set\` sull'elemento, regola ciò che il Markdown non sa esprimere, per esempio \`--prop align=center\`, \`--prop pageBreakBefore=true\` su un titolo che deve aprire una pagina, o \`--prop bold=true\` su un run di testo.

## Modificare un documento già esistente

I documenti dell'utente hanno una loro formattazione, i loro stili e la loro impaginazione. Mantienili tutti.

- Chiedi con \`request_approval\` prima di modificare un file che esisteva prima dell'attività. Tost Work ne conserva una copia.
- Sostituisci il testo sul posto, così la formattazione delle parole intorno resta com'è:

  \`\`\`bash
  officecli set "Contratto.docx" / --find "Alberto Pedrini" --replace "Alberto Pedroni"
  \`\`\`

- Aggiungi un paragrafo dopo uno dato con \`add\` e il percorso di quel paragrafo. Trovi i percorsi con \`officecli view <file> outline\` o \`officecli get <file> /body\`.
- Non ricostruire mai da zero il documento di un utente per cambiarne una parte.

## Stile di scrittura

- Scrivi nella lingua dell'utente, con la sua tipografia: l'italiano usa « » oppure " " e il segno dell'euro prima dell'importo (€ 2.400).
- Usa i titoli per dare struttura, non i paragrafi in grassetto. Usa una tabella quando gli elementi hanno gli stessi attributi.
- Tieni i paragrafi brevi. Chi legge per lavoro scorre il testo in fretta.
- Non lasciare simboli Markdown nel testo finale: niente \`**\`, \`#\` o backtick rimasti.

## Prima di finire

1. \`officecli validate <file>\` deve dire che non ci sono errori. Correggi quelli che segnala.
2. \`officecli view <file> outline\` mostra i titoli: controlla che la struttura si legga bene.
3. \`officecli view <file> text\` ti permette di rileggere il testo una volta per cercare errori.
4. \`officecli view <file> issues\` elenca i problemi di formattazione. Ignora "missing first-line indent": è una convenzione di altre lingue.

## Cose da evitare

- Non attivare \`updateFields\` e non aggiungere campi che puntano ad altri file: Word mostrerebbe all'utente un avviso.
- Non eseguire \`officecli refresh\` su un documento con campi del numero di pagina.
- Non lasciare il file aperto in un processo in background: ogni comando lo salva e lo chiude.`,
  },
};
