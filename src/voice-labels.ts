import type { Language } from './i18n';
import type { VoiceError, VoiceProgress, VoiceState } from './voice-input';

type VoiceLabels = {
  title: string;
  disclosure: string;
  permission: string;
  runtime: string;
  language: string;
  start: string;
  stop: string;
  cancel: string;
  transcript: string;
  review: string;
  apply: string;
  replace: string;
  discard: string;
  pending: string;
  count: string;
  tooLong: string;
  progress: Record<VoiceProgress['stage'], string>;
  downloadHelp: string;
  loadingHelp: string;
  processingHelp: string;
  states: Record<VoiceState, string>;
  errors: Record<VoiceError, string>;
};

export const voiceLabels: Record<Language, VoiceLabels> = {
  en: {
    progress: { preparing: 'Preparing your recording on this device', loading: 'Loading the speech model on this device', downloading: 'Downloading a speech model file', transcribing: 'Transcribing on this device' },
    downloadHelp: 'First use needs internet. Progress is for the current model file, not the whole transcription. You can cancel.',
    loadingHelp: 'First use may download model files; cached files are reused when available. Loading can take a while. You can cancel.',
    processingHelp: 'This can take a while on your device. Your audio stays here. You can cancel.',
    permission: 'Record up to 30 seconds; transcription stays on this device. First use downloads about 45 MB from Hugging Face/CDN, sharing your IP address, not your audio. Review the text before using it. Audio and transcript stay on this device. Only text you review and apply to the brief may be sent when you press Plan.',
    runtime: 'The application also includes a WebAssembly runtime of about 22 MB uncompressed.',
    title: 'Optional voice input',
    disclosure: 'Voice is optional. This action asks for microphone access and records up to 30 seconds; you can stop or cancel. Transcription runs on this device. On first use, about 45 MB of model files are downloaded from Hugging Face and its CDN. That request exposes ordinary network metadata, including your IP address; recordings and transcripts are not sent to Hugging Face. Model files may stay in browser cache, be evicted, and can be removed in site-data settings. Network charges may apply. Transcription needs supported browser features and device memory, and may be slow or inaccurate; typing is always available. Your audio and transcript stay on this device. Only text you review and apply to the brief may be sent to the selected planner when you press Plan.',
    language: 'Speech recognition uses the selected app language when recording starts.',
    start: 'Allow and record',
    stop: 'Stop and transcribe',
    cancel: 'Cancel voice input',
    transcript: 'Review and edit the transcription',
    review: 'Review and edit the text before planning. It stays separate until you choose to use it.',
    apply: 'Replace brief with transcription',
    replace: 'Replace with new transcription',
    discard: 'Discard new transcription',
    pending: 'A new transcription is ready. Your edits were kept; review the new result before replacing this text.',
    count: '{count} / 1,000 characters',
    tooLong: 'This transcription has {count} characters. Nothing has been inserted. Edit it to 1,000 or fewer characters before applying.',
    states: { idle: 'Ready for voice input', requesting: 'Waiting for microphone permission', recording: 'Recording, up to 30 seconds', processing: 'Transcribing on this device', error: 'Voice input stopped' },
    errors: { unsupported: 'Voice input needs a secure page and a supported browser. Type your brief instead.', permission: 'Microphone access was denied. Allow it in your browser or type your brief.', recording: 'Could not record audio. Check your microphone and try again.', empty: 'No speech was transcribed. Try again or type your brief.', 'too-large': 'The recording was too large. Try a shorter recording.', processing: 'Local transcription failed. Check your connection and device memory, then try again or type your brief.' },
  },
  de: {
    progress: { preparing: 'Aufnahme auf diesem Gerät vorbereiten', loading: 'Sprachmodell auf diesem Gerät laden', downloading: 'Eine Sprachmodelldatei wird heruntergeladen', transcribing: 'Transkription auf diesem Gerät' },
    downloadHelp: 'Die erste Nutzung benötigt Internet. Der Fortschritt gilt für die aktuelle Modelldatei, nicht für die gesamte Transkription. Du kannst abbrechen.',
    loadingHelp: 'Bei der ersten Nutzung können Modelldateien geladen werden; verfügbare Dateien im Cache werden wiederverwendet. Das Laden kann dauern. Du kannst abbrechen.',
    processingHelp: 'Das kann auf deinem Gerät etwas dauern. Dein Audio bleibt hier. Du kannst abbrechen.',
    permission: 'Nimm bis zu 30 Sekunden auf; die Transkription bleibt auf diesem Gerät. Die erste Nutzung lädt etwa 45 MB von Hugging Face/CDN und teilt deine IP-Adresse, nicht dein Audio. Prüfe den Text vor der Übernahme. Audio und Transkript bleiben auf diesem Gerät; nur Text, den du in den Auftrag übernimmst, kann beim Drücken von „Planen“ gesendet werden.',
    runtime: 'Die Anwendung enthält außerdem eine WebAssembly-Laufzeit von rund 22 MB unkomprimiert.',
    title: 'Freiwillige Spracheingabe',
    disclosure: 'Spracheingabe ist freiwillig. Diese Aktion fragt nach Mikrofonzugriff und nimmt bis zu 30 Sekunden auf; du kannst stoppen oder abbrechen. Die Transkription erfolgt auf diesem Gerät. Bei der ersten Verwendung werden etwa 45 MB Modelldateien von Hugging Face und dessen CDN heruntergeladen. Dabei werden übliche Netzwerkdaten einschließlich deiner IP-Adresse sichtbar; Aufnahmen und Transkripte werden nicht an Hugging Face gesendet. Modelldateien können im Browser-Cache bleiben, daraus entfernt werden oder in den Website-Daten gelöscht werden. Netzgebühren sind möglich. Die Transkription benötigt unterstützte Browserfunktionen und Gerätespeicher und kann langsam oder ungenau sein; Tippen ist immer möglich. Audio und Transkript bleiben auf diesem Gerät. Nur Text, den du prüfst und in den Auftrag übernimmst, kann beim Drücken von „Planen“ an den gewählten Planer gesendet werden.',
    language: 'Die Spracherkennung verwendet beim Start der Aufnahme die gewählte App-Sprache.',
    start: 'Erlauben und aufnehmen',
    stop: 'Stoppen und transkribieren',
    cancel: 'Spracheingabe abbrechen',
    transcript: 'Transkription prüfen und bearbeiten',
    review: 'Prüfe und bearbeite den Text vor der Planung. Er bleibt getrennt, bis du ihn übernehmen möchtest.',
    apply: 'Auftrag durch Transkription ersetzen',
    replace: 'Durch neue Transkription ersetzen',
    discard: 'Neue Transkription verwerfen',
    pending: 'Eine neue Transkription ist bereit. Deine Änderungen blieben erhalten; prüfe das neue Ergebnis, bevor du diesen Text ersetzt.',
    count: '{count} / 1.000 Zeichen',
    tooLong: 'Diese Transkription hat {count} Zeichen. Es wurde nichts eingefügt. Kürze sie auf höchstens 1.000 Zeichen, bevor du sie übernimmst.',
    states: { idle: 'Spracheingabe bereit', requesting: 'Warte auf Mikrofonfreigabe', recording: 'Aufnahme läuft, bis zu 30 Sekunden', processing: 'Transkription auf diesem Gerät', error: 'Spracheingabe beendet' },
    errors: { unsupported: 'Spracheingabe benötigt eine sichere Seite und einen unterstützten Browser. Tippe den Auftrag stattdessen.', permission: 'Der Mikrofonzugriff wurde verweigert. Erlaube ihn im Browser oder tippe den Auftrag.', recording: 'Aufnahme nicht möglich. Prüfe das Mikrofon und versuche es erneut.', empty: 'Keine Sprache transkribiert. Versuche es erneut oder tippe den Auftrag.', 'too-large': 'Die Aufnahme war zu groß. Versuche eine kürzere Aufnahme.', processing: 'Lokale Transkription fehlgeschlagen. Prüfe Verbindung und Gerätespeicher oder tippe den Auftrag.' },
  },
  fr: {
    progress: { preparing: 'Préparation de votre enregistrement sur cet appareil', loading: 'Chargement du modèle vocal sur cet appareil', downloading: 'Téléchargement d’un fichier du modèle vocal', transcribing: 'Transcription sur cet appareil' },
    downloadHelp: 'La première utilisation nécessite Internet. La progression concerne le fichier actuel, pas toute la transcription. Vous pouvez annuler.',
    loadingHelp: 'La première utilisation peut télécharger des fichiers ; ceux en cache sont réutilisés si disponibles. Le chargement peut prendre du temps. Vous pouvez annuler.',
    processingHelp: 'Cela peut prendre du temps sur votre appareil. Votre audio reste ici. Vous pouvez annuler.',
    permission: 'Enregistrez jusqu’à 30 secondes ; la transcription reste sur cet appareil. La première utilisation télécharge environ 45 Mo depuis Hugging Face/CDN, avec votre adresse IP, pas votre audio. Vérifiez le texte avant de l’utiliser. L’audio et la transcription restent sur cet appareil ; seul le texte ajouté à la consigne peut être envoyé lorsque vous appuyez sur Planifier.',
    runtime: 'L’application comprend aussi un moteur WebAssembly d’environ 22 Mo non compressés.',
    title: 'Saisie vocale facultative',
    disclosure: 'La saisie vocale est facultative. Cette action demande l’accès au micro et enregistre jusqu’à 30 secondes ; vous pouvez arrêter ou annuler. La transcription se fait sur cet appareil. À la première utilisation, environ 45 Mo de fichiers de modèle sont téléchargés depuis Hugging Face et son CDN. Cette requête révèle des métadonnées réseau habituelles, dont votre adresse IP ; les enregistrements et transcriptions ne sont pas envoyés à Hugging Face. Les fichiers peuvent rester dans le cache du navigateur, en être évincés ou être supprimés des données du site. Des frais réseau sont possibles. La transcription nécessite des fonctions de navigateur compatibles et de la mémoire, et peut être lente ou imprécise ; vous pouvez toujours saisir votre texte. L’audio et la transcription restent sur cet appareil. Seul le texte que vous relisez et ajoutez à la consigne peut être envoyé au planificateur choisi lorsque vous appuyez sur Planifier.',
    language: 'La reconnaissance vocale utilise la langue de l’application sélectionnée au début de l’enregistrement.',
    start: 'Autoriser et enregistrer',
    stop: 'Arrêter et transcrire',
    cancel: 'Annuler la saisie vocale',
    transcript: 'Vérifier et modifier la transcription',
    review: 'Vérifiez et modifiez le texte avant de planifier. Il reste séparé jusqu’à ce que vous choisissiez de l’utiliser.',
    apply: 'Remplacer la consigne par la transcription',
    replace: 'Remplacer par la nouvelle transcription',
    discard: 'Ignorer la nouvelle transcription',
    pending: 'Une nouvelle transcription est prête. Vos modifications ont été conservées ; vérifiez le résultat avant de remplacer ce texte.',
    count: '{count} / 1 000 caractères',
    tooLong: 'Cette transcription contient {count} caractères. Aucun texte n’a été inséré. Modifiez-la pour atteindre 1 000 caractères maximum avant de l’utiliser.',
    states: { idle: 'Saisie vocale prête', requesting: 'En attente de l’autorisation du micro', recording: 'Enregistrement en cours, 30 secondes maximum', processing: 'Transcription sur cet appareil', error: 'Saisie vocale arrêtée' },
    errors: { unsupported: 'La saisie vocale nécessite une page sécurisée et un navigateur compatible. Saisissez votre consigne.', permission: 'Accès au micro refusé. Autorisez-le dans le navigateur ou saisissez votre consigne.', recording: 'Enregistrement impossible. Vérifiez le micro et réessayez.', empty: 'Aucune parole transcrite. Réessayez ou saisissez votre consigne.', 'too-large': 'L’enregistrement est trop volumineux. Essayez un enregistrement plus court.', processing: 'Échec de la transcription locale. Vérifiez la connexion et la mémoire ou saisissez votre consigne.' },
  },
  it: {
    progress: { preparing: 'Preparazione della registrazione su questo dispositivo', loading: 'Caricamento del modello vocale su questo dispositivo', downloading: 'Download di un file del modello vocale', transcribing: 'Trascrizione su questo dispositivo' },
    downloadHelp: 'Il primo uso richiede Internet. Il progresso riguarda il file corrente, non l’intera trascrizione. Puoi annullare.',
    loadingHelp: 'Il primo uso può scaricare file; quelli nella cache vengono riutilizzati se disponibili. Il caricamento può richiedere tempo. Puoi annullare.',
    processingHelp: 'Potrebbe volerci tempo sul tuo dispositivo. L’audio resta qui. Puoi annullare.',
    permission: 'Registra fino a 30 secondi; la trascrizione resta su questo dispositivo. Il primo uso scarica circa 45 MB da Hugging Face/CDN, condividendo l’indirizzo IP, non l’audio. Rivedi il testo prima di usarlo. L’audio e la trascrizione restano su questo dispositivo; solo il testo applicato alla richiesta può essere inviato quando premi Pianifica.',
    runtime: 'L’app include anche un runtime WebAssembly di circa 22 MB non compressi.',
    title: 'Input vocale facoltativo',
    disclosure: 'L’input vocale è facoltativo. Questa azione richiede l’accesso al microfono e registra fino a 30 secondi; puoi fermare o annullare. La trascrizione avviene su questo dispositivo. Al primo uso vengono scaricati circa 45 MB di file del modello da Hugging Face e dal suo CDN. La richiesta espone i normali metadati di rete, incluso il tuo indirizzo IP; registrazioni e trascrizioni non vengono inviate a Hugging Face. I file possono restare nella cache del browser, essere rimossi dalla cache o eliminati dai dati del sito. Potrebbero esserci costi di rete. La trascrizione richiede funzioni browser supportate e memoria del dispositivo e può essere lenta o imprecisa; puoi sempre scrivere. L’audio e la trascrizione restano su questo dispositivo. Solo il testo che rivedi e applichi alla richiesta può essere inviato al pianificatore scelto quando premi Pianifica.',
    language: 'Il riconoscimento vocale usa la lingua selezionata nell’app quando inizia la registrazione.',
    start: 'Consenti e registra',
    stop: 'Ferma e trascrivi',
    cancel: 'Annulla input vocale',
    transcript: 'Controlla e modifica la trascrizione',
    review: 'Controlla e modifica il testo prima di pianificare. Resta separato finché non scegli di usarlo.',
    apply: 'Sostituisci la richiesta con la trascrizione',
    replace: 'Sostituisci con la nuova trascrizione',
    discard: 'Scarta la nuova trascrizione',
    pending: 'È pronta una nuova trascrizione. Le tue modifiche sono state mantenute; controlla il nuovo risultato prima di sostituire questo testo.',
    count: '{count} / 1.000 caratteri',
    tooLong: 'Questa trascrizione contiene {count} caratteri. Non è stato inserito nulla. Modificala fino a 1.000 caratteri prima di applicarla.',
    states: { idle: 'Input vocale pronto', requesting: 'In attesa del permesso per il microfono', recording: 'Registrazione in corso, massimo 30 secondi', processing: 'Trascrizione su questo dispositivo', error: 'Input vocale interrotto' },
    errors: { unsupported: 'Serve una pagina sicura e un browser compatibile. Scrivi invece la richiesta.', permission: 'Accesso al microfono negato. Consentilo nel browser o scrivi la richiesta.', recording: 'Registrazione impossibile. Controlla il microfono e riprova.', empty: 'Nessuna voce trascritta. Riprova o scrivi la richiesta.', 'too-large': 'La registrazione è troppo grande. Prova una registrazione più breve.', processing: 'Trascrizione locale non riuscita. Controlla connessione e memoria oppure scrivi la richiesta.' },
  },
  es: {
    progress: { preparing: 'Preparando la grabación en este dispositivo', loading: 'Cargando el modelo de voz en este dispositivo', downloading: 'Descargando un archivo del modelo de voz', transcribing: 'Transcribiendo en este dispositivo' },
    downloadHelp: 'El primer uso necesita Internet. El progreso corresponde al archivo actual, no a toda la transcripción. Puedes cancelar.',
    loadingHelp: 'El primer uso puede descargar archivos; los de la caché se reutilizan si están disponibles. La carga puede tardar. Puedes cancelar.',
    processingHelp: 'Esto puede tardar en tu dispositivo. Tu audio permanece aquí. Puedes cancelar.',
    permission: 'Graba hasta 30 segundos; la transcripción queda en este dispositivo. El primer uso descarga unos 45 MB de Hugging Face/CDN, compartiendo tu dirección IP, no tu audio. Revisa el texto antes de usarlo. El audio y la transcripción permanecen en este dispositivo; solo el texto que apliques a las instrucciones puede enviarse cuando pulses Planificar.',
    runtime: 'La aplicación también incluye un entorno WebAssembly de unos 22 MB sin comprimir.',
    title: 'Entrada de voz opcional',
    disclosure: 'La entrada de voz es opcional. Esta acción solicita acceso al micrófono y graba hasta 30 segundos; puedes detener o cancelar. La transcripción se realiza en este dispositivo. La primera vez se descargan unos 45 MB de archivos del modelo desde Hugging Face y su CDN. La solicitud expone metadatos de red habituales, incluida tu dirección IP; las grabaciones y transcripciones no se envían a Hugging Face. Los archivos pueden permanecer en la caché del navegador, ser expulsados o eliminarse en los datos del sitio. Pueden aplicarse cargos de red. La transcripción necesita funciones compatibles del navegador y memoria del dispositivo, y puede ser lenta o imprecisa; siempre puedes escribir. El audio y la transcripción permanecen en este dispositivo. Solo el texto que revises y apliques a las instrucciones puede enviarse al planificador elegido cuando pulses Planificar.',
    language: 'El reconocimiento de voz usa el idioma de la aplicación seleccionado al empezar a grabar.',
    start: 'Permitir y grabar',
    stop: 'Detener y transcribir',
    cancel: 'Cancelar entrada de voz',
    transcript: 'Revisa y edita la transcripción',
    review: 'Revisa y edita el texto antes de planificar. Se mantiene separado hasta que decidas usarlo.',
    apply: 'Reemplazar las instrucciones con la transcripción',
    replace: 'Reemplazar por la nueva transcripción',
    discard: 'Descartar la nueva transcripción',
    pending: 'Hay una nueva transcripción. Se conservaron tus ediciones; revisa el resultado antes de reemplazar este texto.',
    count: '{count} / 1.000 caracteres',
    tooLong: 'Esta transcripción tiene {count} caracteres. No se ha insertado nada. Edítala para que tenga 1.000 caracteres o menos antes de aplicarla.',
    states: { idle: 'Entrada de voz lista', requesting: 'Esperando permiso del micrófono', recording: 'Grabando, máximo 30 segundos', processing: 'Transcribiendo en este dispositivo', error: 'Entrada de voz detenida' },
    errors: { unsupported: 'La voz necesita una página segura y un navegador compatible. Escribe las instrucciones.', permission: 'Se denegó el micrófono. Permítelo en el navegador o escribe las instrucciones.', recording: 'No se pudo grabar. Comprueba el micrófono y vuelve a intentarlo.', empty: 'No se transcribió voz. Inténtalo de nuevo o escribe las instrucciones.', 'too-large': 'La grabación es demasiado grande. Prueba una más corta.', processing: 'Falló la transcripción local. Comprueba la conexión y la memoria o escribe las instrucciones.' },
  },
  pt: {
    progress: { preparing: 'Preparando a gravação neste dispositivo', loading: 'Carregando o modelo de voz neste dispositivo', downloading: 'Baixando um arquivo do modelo de voz', transcribing: 'Transcrevendo neste dispositivo' },
    downloadHelp: 'O primeiro uso precisa de Internet. O progresso é do arquivo atual, não da transcrição inteira. Você pode cancelar.',
    loadingHelp: 'O primeiro uso pode baixar arquivos; os que estão no cache são reutilizados quando disponíveis. O carregamento pode demorar. Você pode cancelar.',
    processingHelp: 'Isso pode demorar no seu dispositivo. Seu áudio fica aqui. Você pode cancelar.',
    permission: 'Grave até 30 segundos; a transcrição fica neste dispositivo. O primeiro uso baixa cerca de 45 MB do Hugging Face/CDN, compartilhando seu endereço IP, não seu áudio. Revise o texto antes de usar. O áudio e a transcrição ficam neste dispositivo; somente o texto aplicado às instruções pode ser enviado quando você pressionar Planejar.',
    runtime: 'O aplicativo também inclui um ambiente WebAssembly de cerca de 22 MB sem compressão.',
    title: 'Entrada de voz opcional',
    disclosure: 'A entrada de voz é opcional. Esta ação pede acesso ao microfone e grava até 30 segundos; você pode parar ou cancelar. A transcrição ocorre neste dispositivo. No primeiro uso, cerca de 45 MB de arquivos do modelo são baixados do Hugging Face e do CDN. Essa solicitação expõe metadados de rede comuns, incluindo seu endereço IP; gravações e transcrições não são enviadas ao Hugging Face. Os arquivos podem permanecer no cache do navegador, ser removidos do cache ou excluídos nos dados do site. Podem existir custos de rede. A transcrição requer recursos compatíveis do navegador e memória do dispositivo e pode ser lenta ou imprecisa; você sempre pode digitar. O áudio e a transcrição ficam neste dispositivo. Somente o texto que você revisar e aplicar às instruções poderá ser enviado ao planejador escolhido quando você pressionar Planejar.',
    language: 'O reconhecimento de voz usa o idioma selecionado no aplicativo quando a gravação começa.',
    start: 'Permitir e gravar',
    stop: 'Parar e transcrever',
    cancel: 'Cancelar entrada de voz',
    transcript: 'Revise e edite a transcrição',
    review: 'Revise e edite o texto antes de planejar. Ele fica separado até você escolher usá-lo.',
    apply: 'Substituir a instrução pela transcrição',
    replace: 'Substituir pela nova transcrição',
    discard: 'Descartar nova transcrição',
    pending: 'Uma nova transcrição está pronta. Suas edições foram mantidas; revise o resultado antes de substituir este texto.',
    count: '{count} / 1.000 caracteres',
    tooLong: 'Esta transcrição tem {count} caracteres. Nada foi inserido. Edite para 1.000 caracteres ou menos antes de aplicar.',
    states: { idle: 'Entrada de voz pronta', requesting: 'Aguardando permissão do microfone', recording: 'Gravando, até 30 segundos', processing: 'Transcrevendo neste dispositivo', error: 'Entrada de voz interrompida' },
    errors: { unsupported: 'A voz precisa de uma página segura e de um navegador compatível. Digite a instrução.', permission: 'Acesso ao microfone negado. Permita no navegador ou digite a instrução.', recording: 'Não foi possível gravar. Verifique o microfone e tente novamente.', empty: 'Nenhuma fala foi transcrita. Tente novamente ou digite a instrução.', 'too-large': 'A gravação é grande demais. Tente uma gravação menor.', processing: 'Falha na transcrição local. Verifique a conexão e a memória ou digite a instrução.' },
  },
};
