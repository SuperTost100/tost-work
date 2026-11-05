# Informativa privacy

Ultimo aggiornamento: 5 novembre 2026

## Art. 1. Premessa

La presente informativa descrive come l'applicazione desktop Tost Work (l'"Applicazione"), pubblicata da Tommaso Barbera, persona fisica (l'"Autore"), gestisce i dati dell'utente (l'"Utente"). L'Applicazione non raccoglie dati sull'Utente: non prevede account, statistiche d'uso o telemetria, e l'Autore non dispone di server che ricevano i dati dell'Utente. L'informativa è redatta in lingua italiana e in lingua inglese. In caso di difformità prevale la versione italiana.

## Art. 2. Dati conservati sul computer dell'Utente

L'Applicazione conserva nella propria cartella dati le seguenti informazioni:

- le impostazioni, i progetti, le attività con la relativa cronologia e i lavori pianificati;
- quanto l'Utente scrive nella sezione "Su di te";
- le copie dei file modificati da un'attività, che consentono di ripristinare l'originale;
- i log scritti mentre è attiva l'opzione "Mostra dettagli tecnici e debug": il log dell'Applicazione e un log dettagliato di ogni attività, che contiene il testo dei file e delle richieste dell'Utente. Disattivando l'opzione non se ne scrivono di nuovi, ma quelli già scritti restano nella cartella dati; il log di un'attività viene eliminato insieme all'attività;
- la chiave API dell'Utente, cifrata con l'archivio sicuro del sistema operativo. Se il sistema non dispone di tale archivio, la chiave è conservata solo fino alla chiusura dell'Applicazione.

Le skill create dall'Utente si trovano in `Documenti/Tost Work/Skills`, mentre i file dei progetti restano nelle cartelle in cui l'Utente li conserva.

La cartella dati è `~/Library/Application Support/Tost Work` su macOS, `%APPDATA%\Tost Work` su Windows e `~/.config/Tost Work` su Linux (`$XDG_CONFIG_HOME/Tost Work` se tale variabile è impostata). L'eliminazione dell'Applicazione, di questa cartella e di `Documenti/Tost Work` rimuove tutti i dati salvati dall'Applicazione. Se l'Applicazione è impostata per aprirsi all'accesso al computer, si raccomanda di disattivare prima tale opzione nelle Impostazioni, affinché il sistema non tenti più di avviarla.

## Art. 3. Dati trasmessi a OpenAI e ad Anthropic

Le attività sono svolte da Codex CLI, prodotto da OpenAI, o da Claude Code, prodotto da Anthropic, con l'accesso all'account dell'Utente. Durante lo svolgimento di un'attività, tali programmi trasmettono a OpenAI o ad Anthropic:

- la richiesta dell'Utente, le sue risposte alle domande dell'intelligenza artificiale e i file allegati;
- i file letti dall'intelligenza artificiale nella cartella del progetto;
- le skill che l'intelligenza artificiale segue per svolgere l'attività;
- quanto l'Utente ha scritto nella sezione "Su di te", che accompagna ogni attività;
- le ricerche sul web effettuate dall'intelligenza artificiale.

Codex CLI conserva le credenziali di accesso nella cartella dati dell'Applicazione. Claude Code le conserva nella stessa cartella oppure, su alcuni sistemi come macOS, nell'archivio sicuro del sistema operativo. L'uscita dall'account nelle Impostazioni le rimuove in entrambi i casi, e si raccomanda di effettuarla prima di eliminare l'Applicazione. Essi possono inoltre trasmettere a OpenAI e ad Anthropic dati sul proprio utilizzo, come avviene anche al di fuori dell'Applicazione.

OpenAI e Anthropic trattano tali dati secondo le proprie informative sulla privacy e le impostazioni dell'account dell'Utente, anche per quanto riguarda l'uso delle conversazioni per l'addestramento dei modelli:

- [informativa privacy di OpenAI](https://openai.com/it-IT/policies/privacy-policy/)
- [informativa privacy di Anthropic](https://www.anthropic.com/legal/privacy)

Per consultare, esportare o cancellare i dati da esse conservati, o per modificare le impostazioni relative all'addestramento, l'Utente può rivolgersi a OpenAI o ad Anthropic tramite il proprio account.

## Art. 4. Dati condivisi dall'Utente

- **Feedback:** la funzione "Invia un feedback" apre nel browser una nuova segnalazione su GitHub, con la versione dell'Applicazione, il sistema operativo e la lingua già indicati. L'Utente decide cosa aggiungere prima di pubblicarla. Le segnalazioni su GitHub sono pubbliche e soggette all'informativa sulla privacy di GitHub.
- **Log esportati:** la funzione "Esporta i log" crea sul computer dell'Utente un archivio zip con i log dell'Applicazione e un riepilogo delle impostazioni, con le chiavi oscurate e senza il nome né gli account dell'Utente. Se l'opzione di debug era attiva, i log contengono il testo dei file e delle richieste dell'Utente. L'archivio è trasmesso a terzi solo se l'Utente lo invia.
- **Email:** se l'Utente scrive all'Autore, l'indirizzo e il messaggio sono utilizzati al solo fine di rispondere e sono cancellati quando non sono più necessari.

## Art. 5. Titolare del trattamento e diritti dell'Utente

L'Autore non riceve dati personali dall'Applicazione, e i dati conservati sul computer dell'Utente restano nella sua esclusiva disponibilità. Dei dati trasmessi a OpenAI e ad Anthropic rispondono tali società, secondo le rispettive informative. Per le email inviate all'Autore, titolare del trattamento è Tommaso Barbera, al quale l'Utente può chiedere l'accesso ai propri dati o la loro cancellazione all'indirizzo indicato all'art. 7. L'Utente ha inoltre il diritto di proporre reclamo all'autorità di controllo per la protezione dei dati del proprio paese, che in Italia è il Garante per la protezione dei dati personali.

## Art. 6. Modifiche dell'informativa

L'Autore può modificare la presente informativa con una nuova versione dell'Applicazione. La versione aggiornata è distribuita con l'Applicazione e ne riporta la data in apertura.

## Art. 7. Contatti

Tommaso Barbera, tommaso.barbera@tost.one
