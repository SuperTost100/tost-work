<!--
  What changed in each version, in plain language, newest first. A release adds one block at the top:

    ## 0.1.0-alpha
    ### en
    - **Short title:** one or two sentences on what the user sees.
    ### it
    - **Titolo breve:** la stessa cosa in italiano.

  A version is the numbers, then its stage before 1.0.0: 0.0.x-dev for dev builds, 0.1.0-alpha to 0.5.0-alpha, then
  -beta, then 1.0.0 with no stage. The app lists only the entries of its own stage, so the first alpha's entry sums
  up everything before it.

  Every version needs both languages. A version newer than the app isn't shown, so the entry for the next release can
  wait here until the release bumps the version.
-->

## 0.0.28-dev

### en

- **A welcome for testers:** the first time you reach Home in a test build, a card says what to expect and how to report a problem, signed by Tost. It shows once per stage.
- **Report a problem:** in Settings, above What's new, and in the Help menu. It opens GitHub's bug form with the version and the system already filled in, and can export the logs.
- **Pages line up:** every page starts at the left, so the titles of Projects, Jobs and the Board sit in the same place, in any view and at any window size.
- **Keyboard focus rings whole:** recent tasks, their … button, skills, the file tabs and the task box now show the full ring when you move with Tab.

### it

- **Un benvenuto per chi prova l'app:** la prima volta che arrivi alla Home in una versione di prova, una scheda dice cosa aspettarti e come segnalare un problema, con la firma di Tost. Compare una volta per fase.
- **Segnala un problema:** nelle Impostazioni, sopra Novità, e nel menu Aiuto. Apre il modulo per i problemi su GitHub con la versione e il sistema già scritti, e può esportare i log.
- **Pagine allineate:** ogni pagina parte da sinistra, così i titoli di Progetti, Lavori pianificati e Bacheca stanno nello stesso punto, in ogni vista e con qualsiasi larghezza della finestra.
- **Bordo di selezione intero:** le attività recenti, il loro pulsante …, le skill, le schede dei file e la casella dell'attività mostrano tutto il bordo quando ti sposti con Tab.

## 0.0.27-dev

### en

- **The selected item stands out:** in the sidebar, Settings, the board and every toggle, the selected item sits on a light raised card, as the selected tab does in Safari.
- **Fewer text sizes:** the app uses ten sizes instead of nineteen. Sizes that were half a pixel apart now match, and no text got smaller.
- **Bigger switches**, and in dark mode the edges of fields you type into are easier to see.
- **The board lines up** with Projects and Jobs, and stays centred with them in a wide window.
- **Quitting with one task working** now says "it stops" instead of "they stop".
- **Save a copy** opens in the folder where you last saved one, even after a restart.

### it

- **L'elemento scelto si vede meglio:** nella barra laterale, nelle Impostazioni, nella bacheca e in ogni selettore, l'elemento scelto sta su una scheda chiara in rilievo, come la scheda attiva in Safari.
- **Meno dimensioni di testo:** l'app ne usa dieci invece di diciannove. Le dimensioni che differivano di mezzo pixel ora coincidono, e nessun testo è diventato più piccolo.
- **Interruttori più grandi**, e nel tema scuro i bordi dei campi in cui scrivi si vedono meglio.
- **La bacheca è allineata** a Progetti e Lavori pianificati, e in una finestra larga resta centrata come loro.
- **Uscire con un'attività in corso** ora dice «si interrompe» invece di «si interrompono».
- **Salva una copia** si apre nella cartella dove hai salvato l'ultima volta, anche dopo un riavvio.

## 0.0.26-dev

### en

- **Write while the AI works:** the task box stays open during a turn, so you can write your next message and attach files. Send turns on when the turn ends.
- **Quitting and saving in the app's own card:** quitting while a task works, and saving a copy over a file that's already in the folder, now ask in the same card as every other question. Saving offers "Keep both", "Replace" and "Cancel".
- **Don't save on the board too:** a board row or card that asks to replace a file has the same three choices as the task screen. In a narrow window the buttons wrap instead of overlapping.
- **Easier to read:** secondary text, placeholders and your initial in the sidebar have more contrast, small buttons are a little bigger, and macOS "Increase contrast" now makes the app's secondary text and lines stronger.
- **Keyboard:** Tab stays inside a question card until you answer it, and ⌘K doesn't open the search on top of it.
- **Tasks stored a new way:** the first start converts your tasks, after keeping a copy of the old database next to it.

### it

- **Scrivi mentre l'AI lavora:** la casella resta aperta durante un turno, così puoi scrivere il messaggio successivo e allegare file. Invia si attiva quando il turno finisce.
- **Uscire e salvare nella scheda dell'app:** uscire mentre un'attività lavora, e salvare una copia sopra un file che c'è già nella cartella, ora chiedono nella stessa scheda di tutte le altre domande. Il salvataggio offre «Tienili tutti e due», «Sostituisci» e «Annulla».
- **Non salvare anche nella bacheca:** una riga o una scheda della bacheca che chiede di sostituire un file ha le stesse tre scelte della schermata dell'attività. In una finestra stretta i pulsanti vanno a capo invece di sovrapporsi.
- **Più leggibile:** il testo secondario, i testi di esempio nei campi e la tua iniziale nella barra laterale hanno più contrasto, i pulsanti piccoli sono un po' più grandi, e «Aumenta contrasto» di macOS ora rende più marcati il testo secondario e le linee dell'app.
- **Tastiera:** Tab resta nella scheda di una domanda finché non rispondi, e ⌘K non apre la ricerca sopra di essa.
- **Attività salvate in un modo nuovo:** al primo avvio l'app converte le tue attività, dopo aver tenuto una copia del vecchio database accanto.

## 0.0.25-dev

### en

- **Signed and notarized:** the app now carries an Apple Developer ID signature and Apple's notarization, so it opens straight away. No more Open Anyway in Privacy & Security.
- **Don't save:** when the AI wants to replace a file, you can now turn it down altogether. The file stays as it is and the AI saves nothing in its place, not even under a new name.
- **Long file lists:** the side panel shows the first five files a task made, then "Show all". A task that made many files no longer pushes everything else out of sight.
- **Replies in your language:** the AI answers in the language you write in, not the app's. Until you've written something, it uses the app's language.
- **Balanced on ChatGPT:** back to GPT-6.1 Terra at medium reasoning. High barely thought more, and the early stops it was meant to fix came from elsewhere.
- **File tabs:** a mouse wheel moves the tabs above the preview smoothly. A page scroll that passes over them keeps scrolling the page.

### it

- **Firmata e notarizzata:** l'app ora ha la firma Apple Developer ID e la notarizzazione di Apple, quindi si apre subito. Non serve più «Apri comunque» in Privacy e sicurezza.
- **Non salvare:** quando l'AI vuole sostituire un file, ora puoi rifiutare del tutto. Il file resta com'è e l'AI non salva niente al suo posto, nemmeno con un altro nome.
- **Elenchi lunghi di file:** il pannello laterale mostra i primi cinque file creati dall'attività, poi "Mostra tutti". Un'attività che crea molti file non nasconde più il resto.
- **Risposte nella tua lingua:** l'AI risponde nella lingua in cui scrivi, non in quella dell'app. Finché non hai scritto niente, usa la lingua dell'app.
- **Equilibrato su ChatGPT:** torna a GPT-6.1 Terra con ragionamento medio. Con quello alto ragionava appena di più, e le interruzioni che doveva evitare dipendevano da altro.
- **Schede dei file:** la rotellina del mouse fa scorrere in modo fluido le schede sopra l'anteprima. Se stai scorrendo la pagina e passi sopra le schede, continua a scorrere la pagina.

## 0.0.24-dev

### en

- **Drag and paste files:** drop files anywhere on the window, or paste them with ⌘V, to attach them. A copied screenshot attaches too.
- **Files without a message:** you can send files with no text, as in a chat app. The AI looks at them and asks what you'd like done, unless the conversation already says.
- **Attach opens where you left off:** the + button opens the folder you last picked files from with it.
- **Worked for:** when the AI finishes, what it did on the way folds into one line, "Worked for 2 min 35 s". Open it to see the steps, the activity and the questions you answered. The time leaves out the time it waited for your answers.
- **Balanced on ChatGPT:** it now runs GPT-6.1 Terra at high reasoning instead of medium, which stopped before the work was done.
- **Finished tasks open at the end:** opening a task that's done shows its last answer and its files, not the top.
- **Open questions:** after you answer one question in a round, the cursor moves to the next question's box when that one has no options.
- **Changed files:** the side panel says "Changed by this task" when the AI only edited files that were there, and "Made and changed" when it did both.
- **What's new in Settings:** a "What's new" item sits just above About in the Settings list.
- **Long briefs on Home:** the box stops growing after about eight lines and scrolls, so the greeting stays put.
- **File tabs:** a mouse wheel scrolls the tabs above the preview, not only a trackpad.

### it

- **Trascina e incolla i file:** trascina i file in un punto qualsiasi della finestra, o incollali con ⌘V, per allegarli. Si allega anche uno screenshot copiato.
- **File senza messaggio:** puoi mandare file senza scrivere niente, come in una chat. L'AI li guarda e ti chiede cosa vuoi farne, se non lo dice già la conversazione.
- **Allega riparte da dove eri:** il pulsante + apre la cartella da cui hai scelto i file l'ultima volta con lo stesso pulsante.
- **Ha lavorato per:** quando l'AI finisce, quello che ha fatto per arrivarci si chiude in una riga, "Ha lavorato per 2 min 35 s". Aprila per vedere i passaggi, le attività e le domande a cui hai risposto. Il tempo non conta l'attesa delle tue risposte.
- **Equilibrato su ChatGPT:** ora usa GPT-6.1 Terra con ragionamento alto invece che medio, che si fermava prima di finire il lavoro.
- **Le attività finite si aprono in fondo:** aprire un'attività conclusa mostra l'ultima risposta e i file, non l'inizio.
- **Domande aperte:** dopo aver risposto a una domanda di un giro, il cursore passa nella casella della domanda successiva quando questa non ha opzioni.
- **File modificati:** il pannello laterale dice "Modificati da questa attività" quando l'AI ha solo cambiato file che c'erano già, e "Creati e modificati" quando ha fatto entrambe le cose.
- **Novità nelle Impostazioni:** la voce "Novità" è nella lista delle Impostazioni, subito sopra Informazioni.
- **Richieste lunghe nella Home:** la casella smette di crescere dopo circa otto righe e scorre, così il saluto resta al suo posto.
- **Schede dei file:** anche la rotella del mouse fa scorrere le schede sopra l'anteprima, non solo il trackpad.

## 0.0.23-dev

### en

- **Version names:** builds now say their stage after the number. This one is "0.0.23 dev", the alphas will be "0.1.0 alpha" to "0.5.0 alpha", then come the betas and 1.0.0. What's new lists only the versions of the same stage.
- **Recent tasks:** the sidebar heading is now "Recent tasks".
- **About:** the line under the name reads "AI that works with you."
- **The model of older tasks:** a task from before the choices were kept shows the choice its model matches, or "Custom", instead of "Model".
- **No more stray lines:** clicking a task and then pressing a key such as Shift no longer draws a black line around it, and neither does answering a question. The outline shows only when you move with Tab or the arrow keys.
- **Scheduled jobs:** the columns use the whole width, so the last run's file name isn't cut short.
- **The AI finishes what you ask:** it does the whole request before it stops, instead of stopping halfway to list what's left. It still stops to ask you something or to ask before replacing a file.
- **Follow-ups:** while the AI works on a follow-up, the preview of the earlier result is hidden, and it comes back when the work ends.
- **Replaced files:** a file the AI replaced takes two lines in the side panel, with "Earlier version" under its name and Restore beside it.
- **File tabs:** when the files don't all fit above the preview, the tabs fade out at the edge instead of being cut off.

### it

- **Nomi delle versioni:** le build ora dicono la loro fase dopo il numero. Questa è "0.0.23 dev", le alpha saranno da "0.1.0 alpha" a "0.5.0 alpha", poi arriveranno le beta e la 1.0.0. Le novità elencano solo le versioni della stessa fase.
- **Attività recenti:** il titolo nella barra laterale ora è "Attività recenti".
- **Informazioni:** la riga sotto il nome dice "L'AI che lavora con te."
- **Il modello delle attività più vecchie:** un'attività di prima che le scelte venissero salvate mostra la scelta a cui corrisponde il suo modello, oppure "Personalizzato", invece di "Modello".
- **Niente più righe strane:** cliccare un'attività e poi premere un tasto come Maiusc non disegna più una riga nera intorno, e nemmeno rispondere a una domanda. Il contorno compare solo quando ti sposti con Tab o con le frecce.
- **Lavori pianificati:** le colonne usano tutta la larghezza, così il nome del file dell'ultima esecuzione non viene tagliato.
- **L'AI finisce quello che chiedi:** fa tutta la richiesta prima di fermarsi, invece di fermarsi a metà per elencare quello che manca. Si ferma ancora per farti una domanda o per chiederti prima di sostituire un file.
- **Richieste successive:** mentre l'AI lavora a una nuova richiesta, l'anteprima del risultato precedente è nascosta e torna quando il lavoro finisce.
- **File sostituiti:** un file che l'AI ha sostituito occupa due righe nel pannello laterale, con "Versione precedente" sotto il nome e Ripristina accanto.
- **Schede dei file:** quando i file non stanno tutti sopra l'anteprima, le schede sfumano sul bordo invece di essere tagliate.

## 0.0.22-dev

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

## 0.0.21-dev

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

## 0.0.20-dev

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

## 0.0.19-dev

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
