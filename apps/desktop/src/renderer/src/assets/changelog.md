<!--
  What changed in each version, in plain language, newest first. A release adds one block at the top:

    ## 0.0.21
    ### en
    - **Short title:** one or two sentences on what the user sees.
    ### it
    - **Titolo breve:** la stessa cosa in italiano.

  Every version needs both languages. A version newer than the app isn't shown, so the entry for the next release can
  wait here until the release bumps the version.
-->

## 0.0.22

### en

- **Open questions:** when the AI needs your own words, such as a description or a list, its question comes with no options, just a box to write your answer in. It still counts as waiting for you and notifies you.
- **A friendlier tone:** the AI talks to you informally and asks every question it has in one round, in the question card instead of in a message.
- **Drafts:** "To do" on Home and the Board is now called "Drafts", like the tooltip in Recent.
- **Stopped tasks in Recent:** a stopped task, including one interrupted when Tost Work closed, shows a grey square, and a failed one shows a red warning.
- **The model in the side panel:** the row's title is the choice, such as "Balanced", with the model and reasoning level under it.
- **Lighter Claude tasks:** Claude no longer gets the tools Tost Work never uses, so a task sends about 40% fewer tokens and uses less of your plan. ChatGPT's apps and plugins are off in tasks too.
- **About:** it sits at the bottom of the Settings list, apart from the settings.

### it

- **Domande aperte:** quando l'AI ha bisogno di parole tue, come una descrizione o un elenco, la domanda arriva senza opzioni, solo con una casella dove scrivere la risposta. L'attività risulta comunque in attesa di te e ti avvisa.
- **Un tono più amichevole:** l'AI ti dà del tu e fa tutte le domande che ha in un solo giro, nella scheda delle domande invece che in un messaggio.
- **Bozze:** "Da fare" nella Home e nella Bacheca ora si chiama "Bozze", come nel suggerimento di Recenti.
- **Attività interrotte in Recenti:** un'attività interrotta, anche quando si è fermata perché hai chiuso Tost Work, mostra un quadrato grigio, e una non riuscita mostra un avviso rosso.
- **Il modello nel pannello laterale:** il titolo della riga è la scelta, per esempio "Equilibrato", con sotto il modello e il livello di ragionamento.
- **Attività con Claude più leggere:** Claude non riceve più gli strumenti che Tost Work non usa mai, quindi un'attività manda circa il 40% di token in meno e consuma meno del tuo abbonamento. Anche le app e i plugin di ChatGPT sono spenti nelle attività.
- **Informazioni:** sta in fondo all'elenco di Impostazioni, separata dalle impostazioni.

## 0.0.21

### en

- **What to check stands out:** in Recent, a task waiting for you to look at it has an amber dot. The check mark is for tasks you've already checked. A task saved for later is called a draft.
- **The model behind each task:** a task's side panel says which choice and model it ran on, such as "Balanced · GPT-6.1 Terra · medium", or "Custom" for a model picked from the list. Under the task box, every level now sees the model behind each choice.
- **Model list:** it opens below the task box every time, the Reasoning row stays in view, and the full list shows only the newest model of each family.
- **What you were typing stays:** text and files typed in a task are still there after you open another task and come back.
- **About:** now the last item in the Settings list.
- **Export logs:** at the Expert level, Settings saves the app log, the task logs and a summary of the app's state in one zip, ready to send. Keys are masked everywhere, and the summary leaves out your name, notes and emails. The task logs keep what your tasks read and wrote, so look before you send it to someone.
- **Command output:** when the AI reads back a long command's output, the step says "Reading a command's output" instead of a file name made of random letters.
- **Helpers in debug mode:** the steps a helper takes show under its "Handing off" line, and the log also keeps everything the AI's command-line tool prints.
- **Small fixes:** the copy button and the time line up with the message, and Settings rows wrap instead of squeezing with large text.

### it

- **Quello da vedere si nota:** in Recenti, un'attività che aspetta che tu la guardi ha un pallino ambra. La spunta resta per le attività che hai già controllato. Un'attività salvata per dopo si chiama bozza.
- **Il modello di ogni attività:** il pannello laterale di un'attività dice con quale scelta e quale modello ha lavorato, per esempio "Equilibrato · GPT-6.1 Terra · medio", oppure "Personalizzato" per un modello scelto dall'elenco. Sotto la casella, ogni livello ora vede il modello dietro ogni scelta.
- **Elenco dei modelli:** si apre sempre sotto la casella, la riga del ragionamento resta in vista e l'elenco completo mostra solo il modello più recente di ogni famiglia.
- **Quello che scrivi resta:** il testo e i file che hai messo in un'attività ci sono ancora quando apri un'altra attività e torni indietro.
- **Informazioni:** ora è l'ultima voce dell'elenco di Impostazioni.
- **Esporta i log:** al livello Esperto, Impostazioni salva in un unico zip il log dell'app, i log delle attività e un riepilogo dello stato dell'app, pronto da inviare. Le chiavi sono nascoste ovunque, e il riepilogo non contiene il tuo nome, le note e le email. I log delle attività contengono quello che le attività hanno letto e scritto, quindi dai un'occhiata prima di mandarlo a qualcuno.
- **Risultato dei comandi:** quando l'AI rilegge il risultato lungo di un comando, il passaggio dice "Leggo il risultato di un comando" invece di un nome di file fatto di lettere a caso.
- **Aiutanti in modalità debug:** i passaggi di un aiutante compaiono sotto la sua riga "Delego", e il log tiene anche tutto quello che scrive lo strumento a riga di comando dell'AI.
- **Piccole correzioni:** il pulsante per copiare e l'orario sono allineati al messaggio, e con il testo grande le righe di Impostazioni vanno a capo invece di schiacciarsi.

## 0.0.20

### en

- **Choose how the AI works:** under the task box, pick Fast, Balanced or Thorough, each with a line saying when it fits. "Choose the model…" opens the full list of AIs, models and reasoning levels. From the Advanced level, each choice also names the model behind it. Your last pick stays for the next task.
- **Recent:** each task's state is a small icon: a hand when it needs you, a turning ring while it works, a check when it's done and waiting for you to look, a dashed circle when it's saved for later. On hover the ⋯ button takes the icon's place, and the row's tooltip says the state in words.
- **Message times:** every message, yours and the AI's, shows when it was sent, beside its copy button.
- **About:** a page with the version, what's new, credits and licences, and a way to send feedback. Settings and the app menu open it.
- **Errors in Italian:** the messages that used to appear in English now follow the app's language.
- **Small windows:** Settings, a skill's page, a project's page, a task's file and quick edit no longer get squeezed or cut off in a small window or with large text.
- **ChatGPT's helpers:** while ChatGPT waits for work it handed off, the task says so.

### it

- **Scegli come lavora l'AI:** sotto la casella scegli Veloce, Equilibrato o Approfondito, ognuno con una riga che dice quando conviene. "Scegli il modello…" apre l'elenco completo di AI, modelli e livelli di ragionamento. Dal livello Avanzato, sotto ogni scelta compare anche il modello. L'ultima scelta resta per l'attività successiva.
- **Recenti:** lo stato di ogni attività è una piccola icona: una mano quando tocca a te, un cerchio che gira mentre lavora, una spunta quando è finita e aspetta che la guardi, un cerchio tratteggiato quando è salvata per dopo. Al passaggio del mouse il pulsante ⋯ prende il posto dell'icona, e il suggerimento della riga dice lo stato a parole.
- **Orari dei messaggi:** ogni messaggio, tuo e dell'AI, mostra quando è stato inviato, accanto al pulsante per copiarlo.
- **Informazioni:** una pagina con la versione, le novità, i crediti e le licenze, e un modo per inviare un feedback. Si apre da Impostazioni e dal menu dell'app.
- **Errori in italiano:** i messaggi che comparivano in inglese ora seguono la lingua dell'app.
- **Finestre piccole:** Impostazioni, la pagina di una skill, quella di un progetto, il file di un'attività e la modifica veloce non vengono più schiacciati o tagliati in una finestra piccola o con il testo grande.
- **Aiutanti di ChatGPT:** mentre ChatGPT aspetta il lavoro che ha delegato, l'attività lo dice.

## 0.0.19

### en

- **Debug mode:** at the Expert level, Settings has an Advanced section with "Show technical details and debug". Once it is on, it stays on at any level. Each step a task took opens to show the command, its output and the thinking before it, and the top of a task shows which AI, model and session it used. The task menu can open or copy the task's log, and Settings opens the app's own log. Keys are masked, and nothing is sent anywhere.
- **Claude waits for its work:** it no longer leaves a command running in the background and ends the task. Work it hands to a helper shows as "Handing off", with what the helper writes.
- **Right-click in text fields:** Cut, Copy, Paste and Select all.
- **Recent:** the tag is back at the right edge. On hover the ⋯ button comes on top, and the tag fades under it.
- **Wording:** the task menu says "Mark as checked" and "Mark to check" again.
- **Running cards:** the dashed border is darker.

### it

- **Modalità debug:** al livello Esperto, in Impostazioni c'è la sezione Avanzate con "Mostra dettagli tecnici e debug". Una volta attivata, resta attiva a qualunque livello. Ogni riga di "Cosa ha fatto" si apre e mostra il comando, il suo risultato e il ragionamento che lo precede, e in cima a un'attività si vede quale AI, quale modello e quale sessione ha usato. Il menu dell'attività può aprire o copiare il log, e Impostazioni apre il log dell'app. Le chiavi sono nascoste e non viene inviato nulla.
- **Claude aspetta il suo lavoro:** non lascia più un comando in esecuzione in background chiudendo l'attività. Il lavoro affidato a un aiutante compare come "Delego", con quello che scrive l'aiutante.
- **Clic destro nei campi di testo:** Taglia, Copia, Incolla e Seleziona tutto.
- **Recenti:** l'etichetta è tornata sul bordo destro. Al passaggio del mouse compare sopra il pulsante ⋯, e l'etichetta sfuma sotto di esso.
- **Diciture:** il menu dell'attività dice di nuovo "Segna come controllata" e "Segna da controllare".
- **Schede in corso:** il bordo tratteggiato è più scuro.
