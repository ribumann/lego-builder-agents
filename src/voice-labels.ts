import type { Language } from './i18n';
import type { VoiceError, VoiceState } from './voice-input';

type VoiceLabels = {
  title: string;
  disclosure: string;
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
  states: Record<VoiceState, string>;
  errors: Record<VoiceError, string>;
};

export const voiceLabels: Record<Language, VoiceLabels> = {
  en: {
    runtime: 'The application also includes a WebAssembly runtime of about 22 MB uncompressed.',
    title: 'Optional voice input',
    disclosure: 'Voice is optional. This action asks for microphone access and records up to 30 seconds; you can stop or cancel. Transcription runs on this device. On first use, about 45 MB of model files are downloaded from Hugging Face and its CDN. That request exposes ordinary network metadata, including your IP address; recordings and transcripts are not sent to Hugging Face. Model files may stay in browser cache, be evicted, and can be removed in site-data settings. Network charges may apply. Transcription needs supported browser features and device memory, and may be slow or inaccurate; typing is always available. Other planning choices may separately send the brief you choose to use.',
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
    runtime: 'Die Anwendung enthält außerdem eine WebAssembly-Laufzeit von rund 22 MB unkomprimiert.',
    title: 'Freiwillige Spracheingabe',
    disclosure: 'Spracheingabe ist freiwillig. Diese Aktion fragt nach Mikrofonzugriff und nimmt bis zu 30 Sekunden auf; du kannst stoppen oder abbrechen. Die Transkription erfolgt auf diesem Gerät. Bei der ersten Verwendung werden etwa 45 MB Modelldateien von Hugging Face und dessen CDN heruntergeladen. Dabei werden übliche Netzwerkdaten einschließlich deiner IP-Adresse sichtbar; Aufnahmen und Transkripte werden nicht an Hugging Face gesendet. Modelldateien können im Browser-Cache bleiben, daraus entfernt werden oder in den Website-Daten gelöscht werden. Netzgebühren sind möglich. Die Transkription benötigt unterstützte Browserfunktionen und Gerätespeicher und kann langsam oder ungenau sein; Tippen ist immer möglich. Andere Planungsoptionen können den von dir verwendeten Auftrag separat senden.',
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
    runtime: 'L’application comprend aussi un moteur WebAssembly d’environ 22 Mo non compressés.',
    title: 'Saisie vocale facultative',
    disclosure: 'La saisie vocale est facultative. Cette action demande l’accès au micro et enregistre jusqu’à 30 secondes ; vous pouvez arrêter ou annuler. La transcription se fait sur cet appareil. À la première utilisation, environ 45 Mo de fichiers de modèle sont téléchargés depuis Hugging Face et son CDN. Cette requête révèle des métadonnées réseau habituelles, dont votre adresse IP ; les enregistrements et transcriptions ne sont pas envoyés à Hugging Face. Les fichiers peuvent rester dans le cache du navigateur, en être évincés ou être supprimés des données du site. Des frais réseau sont possibles. La transcription nécessite des fonctions de navigateur compatibles et de la mémoire, et peut être lente ou imprécise ; vous pouvez toujours saisir votre texte. D’autres options de planification peuvent envoyer séparément la consigne que vous choisissez d’utiliser.',
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
    runtime: 'L’app include anche un runtime WebAssembly di circa 22 MB non compressi.',
    title: 'Input vocale facoltativo',
    disclosure: 'L’input vocale è facoltativo. Questa azione richiede l’accesso al microfono e registra fino a 30 secondi; puoi fermare o annullare. La trascrizione avviene su questo dispositivo. Al primo uso vengono scaricati circa 45 MB di file del modello da Hugging Face e dal suo CDN. La richiesta espone i normali metadati di rete, incluso il tuo indirizzo IP; registrazioni e trascrizioni non vengono inviate a Hugging Face. I file possono restare nella cache del browser, essere rimossi dalla cache o eliminati dai dati del sito. Potrebbero esserci costi di rete. La trascrizione richiede funzioni browser supportate e memoria del dispositivo e può essere lenta o imprecisa; puoi sempre scrivere. Altre modalità di pianificazione possono inviare separatamente la richiesta che scegli di usare.',
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
    runtime: 'La aplicación también incluye un entorno WebAssembly de unos 22 MB sin comprimir.',
    title: 'Entrada de voz opcional',
    disclosure: 'La entrada de voz es opcional. Esta acción solicita acceso al micrófono y graba hasta 30 segundos; puedes detener o cancelar. La transcripción se realiza en este dispositivo. La primera vez se descargan unos 45 MB de archivos del modelo desde Hugging Face y su CDN. La solicitud expone metadatos de red habituales, incluida tu dirección IP; las grabaciones y transcripciones no se envían a Hugging Face. Los archivos pueden permanecer en la caché del navegador, ser expulsados o eliminarse en los datos del sitio. Pueden aplicarse cargos de red. La transcripción necesita funciones compatibles del navegador y memoria del dispositivo, y puede ser lenta o imprecisa; siempre puedes escribir. Otras opciones de planificación pueden enviar por separado las instrucciones que decidas usar.',
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
    runtime: 'O aplicativo também inclui um ambiente WebAssembly de cerca de 22 MB sem compressão.',
    title: 'Entrada de voz opcional',
    disclosure: 'A entrada de voz é opcional. Esta ação pede acesso ao microfone e grava até 30 segundos; você pode parar ou cancelar. A transcrição ocorre neste dispositivo. No primeiro uso, cerca de 45 MB de arquivos do modelo são baixados do Hugging Face e do CDN. Essa solicitação expõe metadados de rede comuns, incluindo seu endereço IP; gravações e transcrições não são enviadas ao Hugging Face. Os arquivos podem permanecer no cache do navegador, ser removidos do cache ou excluídos nos dados do site. Podem existir custos de rede. A transcrição requer recursos compatíveis do navegador e memória do dispositivo e pode ser lenta ou imprecisa; você sempre pode digitar. Outras opções de planejamento podem enviar separadamente a instrução que você escolher usar.',
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
