import { getLanguage, type Language } from './i18n';

type Target = 'local' | 'copilot' | 'local-ai' | 'azure' | 'compatible' | 'hosted';
type ImagePayload = { mimeType: string; data: string };
type Labels = {
  title: string; disclosure: string; destination: Record<Target, string>; copilotEnabled: string; choose: string; remove: string;
  selected: string; none: string; consent: string; invalid: string; required: string; unavailable: string;
};

const labels: Record<Language, Labels> = {
  en: {
    copilotEnabled: 'Planning sends this image and its metadata to GitHub through the Windows Copilot CLI and may consume quota. Windows containment and private storage are checked for each request; model vision support and accuracy are unverified.',
    title: 'Optional reference image', disclosure: 'Choose a PNG or JPEG up to 1 MB. The original file can contain location, camera or other metadata; it is not stripped. Only choose an image you have permission to share.',
    destination: { local: 'Offline templates cannot use images.', copilot: 'Copilot image planning is unavailable until attachment process-tree safety is verified.', 'local-ai': 'Planning sends the image to the server-hosted Ollama model only if it reports vision support.', azure: 'Azure image planning is unavailable.', compatible: 'Planning sends the image to the configured compatible service only if its operator enabled vision.', hosted: 'Hosted image planning is unavailable.' },
    choose: 'Choose image', remove: 'Remove image', selected: 'Image selected; it is not sent until you consent and plan.', none: 'No image selected.', consent: 'I consent to send this image and its metadata to the destination above when I plan.', invalid: 'Choose a PNG or JPEG no larger than 1 MB.', required: 'Consent to send the selected image or remove it before planning.', unavailable: 'Images are unavailable for this planning mode. Remove the image or choose another mode.',
  },
  de: {
    copilotEnabled: 'Die Planung sendet dieses Bild und seine Metadaten über die Windows-Copilot-CLI an GitHub und kann Kontingent verbrauchen. Windows-Prozessisolierung und privater Speicher werden bei jeder Anfrage geprüft; Bildunterstützung und Genauigkeit des Modells sind nicht verifiziert.',
    title: 'Optionales Referenzbild', disclosure: 'Wähle ein PNG oder JPEG bis 1 MB. Die Originaldatei kann Standort-, Kamera- oder andere Metadaten enthalten; sie werden nicht entfernt. Teile nur Bilder, für die du eine Erlaubnis hast.',
    destination: { local: 'Offline-Vorlagen können keine Bilder verwenden.', copilot: 'Copilot-Bildplanung ist nicht verfügbar, bis die Sicherheit des Prozessbaums für Anhänge geprüft ist.', 'local-ai': 'Die Planung sendet das Bild nur dann an das Ollama-Modell auf dem Server, wenn es Bildverarbeitung meldet.', azure: 'Azure-Bildplanung ist nicht verfügbar.', compatible: 'Die Planung sendet das Bild nur an den konfigurierten Dienst, wenn dessen Betreiber Bildverarbeitung aktiviert hat.', hosted: 'Bildplanung im gehosteten Dienst ist nicht verfügbar.' },
    choose: 'Bild wählen', remove: 'Bild entfernen', selected: 'Bild ausgewählt; es wird erst mit Zustimmung und Planung gesendet.', none: 'Kein Bild ausgewählt.', consent: 'Ich stimme zu, dieses Bild und seine Metadaten beim Planen an das obige Ziel zu senden.', invalid: 'Wähle ein PNG oder JPEG mit höchstens 1 MB.', required: 'Stimme dem Senden des Bildes zu oder entferne es vor der Planung.', unavailable: 'Bilder sind in diesem Planungsmodus nicht verfügbar. Entferne das Bild oder wähle einen anderen Modus.',
  },
  fr: {
    copilotEnabled: 'La planification envoie cette image et ses métadonnées à GitHub via la CLI Copilot Windows et peut consommer du quota. Le confinement Windows et le stockage privé sont vérifiés à chaque requête ; la vision et la précision du modèle ne sont pas vérifiées.',
    title: 'Image de référence facultative', disclosure: 'Choisissez un PNG ou JPEG de 1 Mo maximum. Le fichier original peut contenir des métadonnées de lieu, appareil ou autres ; elles ne sont pas supprimées. Partagez seulement une image autorisée.',
    destination: { local: 'Les modèles hors ligne ne prennent pas les images.', copilot: 'Les images Copilot sont indisponibles tant que la sécurité des processus liés aux pièces jointes n’est pas vérifiée.', 'local-ai': 'La planification envoie l’image au modèle Ollama du serveur seulement s’il annonce la vision.', azure: 'La planification d’image Azure est indisponible.', compatible: 'La planification envoie l’image au service compatible configuré seulement si son exploitant a activé la vision.', hosted: 'La planification d’image hébergée est indisponible.' },
    choose: 'Choisir une image', remove: 'Retirer l’image', selected: 'Image sélectionnée ; elle ne sera envoyée qu’avec votre accord et la planification.', none: 'Aucune image sélectionnée.', consent: 'J’accepte d’envoyer cette image et ses métadonnées à la destination ci-dessus lors de la planification.', invalid: 'Choisissez un PNG ou JPEG de 1 Mo maximum.', required: 'Acceptez l’envoi de l’image ou retirez-la avant de planifier.', unavailable: 'Les images sont indisponibles pour ce mode. Retirez l’image ou choisissez un autre mode.',
  },
  it: {
    copilotEnabled: 'La pianificazione invia questa immagine e i metadati a GitHub tramite la CLI Copilot Windows e può consumare quota. Isolamento Windows e archivio privato sono controllati a ogni richiesta; supporto visivo e precisione del modello non sono verificati.',
    title: 'Immagine di riferimento facoltativa', disclosure: 'Scegli un PNG o JPEG fino a 1 MB. Il file originale può contenere posizione, fotocamera o altri metadati; non vengono rimossi. Condividi solo immagini autorizzate.',
    destination: { local: 'I modelli offline non usano immagini.', copilot: 'Le immagini Copilot non sono disponibili finché non è verificata la sicurezza dei processi degli allegati.', 'local-ai': 'La pianificazione invia l’immagine al modello Ollama sul server solo se dichiara il supporto visivo.', azure: 'La pianificazione con immagini Azure non è disponibile.', compatible: 'La pianificazione invia l’immagine al servizio compatibile configurato solo se il gestore ha abilitato la visione.', hosted: 'La pianificazione con immagini ospitata non è disponibile.' },
    choose: 'Scegli immagine', remove: 'Rimuovi immagine', selected: 'Immagine selezionata; sarà inviata solo con il consenso e la pianificazione.', none: 'Nessuna immagine selezionata.', consent: 'Acconsento a inviare immagine e metadati alla destinazione sopra durante la pianificazione.', invalid: 'Scegli un PNG o JPEG di massimo 1 MB.', required: 'Acconsenti all’invio dell’immagine o rimuovila prima di pianificare.', unavailable: 'Le immagini non sono disponibili in questa modalità. Rimuovi l’immagine o scegli un’altra modalità.',
  },
  es: {
    copilotEnabled: 'La planificación envía esta imagen y sus metadatos a GitHub mediante la CLI de Copilot para Windows y puede consumir cuota. El aislamiento de Windows y el almacenamiento privado se comprueban en cada solicitud; la visión y precisión del modelo no están verificadas.',
    title: 'Imagen de referencia opcional', disclosure: 'Elige un PNG o JPEG de hasta 1 MB. El archivo original puede contener ubicación, cámara u otros metadatos; no se eliminan. Comparte solo imágenes autorizadas.',
    destination: { local: 'Las plantillas sin conexión no usan imágenes.', copilot: 'Las imágenes de Copilot no están disponibles hasta verificar la seguridad de los procesos de los adjuntos.', 'local-ai': 'La planificación envía la imagen al modelo Ollama del servidor solo si indica compatibilidad visual.', azure: 'La planificación de imágenes en Azure no está disponible.', compatible: 'La planificación envía la imagen al servicio compatible configurado solo si su operador activó visión.', hosted: 'La planificación de imágenes alojada no está disponible.' },
    choose: 'Elegir imagen', remove: 'Quitar imagen', selected: 'Imagen seleccionada; solo se enviará con consentimiento al planificar.', none: 'No hay imagen seleccionada.', consent: 'Acepto enviar esta imagen y sus metadatos al destino indicado al planificar.', invalid: 'Elige un PNG o JPEG de 1 MB como máximo.', required: 'Acepta el envío de la imagen o quítala antes de planificar.', unavailable: 'Las imágenes no están disponibles en este modo. Quita la imagen o elige otro modo.',
  },
  pt: {
    copilotEnabled: 'O planejamento envia esta imagem e seus metadados ao GitHub pela CLI do Copilot para Windows e pode consumir cota. O isolamento Windows e o armazenamento privado são verificados a cada solicitação; visão e precisão do modelo não foram verificadas.',
    title: 'Imagem de referência opcional', disclosure: 'Escolha um PNG ou JPEG de até 1 MB. O arquivo original pode conter localização, câmera ou outros metadados; eles não são removidos. Compartilhe apenas imagens autorizadas.',
    destination: { local: 'Modelos offline não usam imagens.', copilot: 'Imagens no Copilot estão indisponíveis até verificar a segurança dos processos de anexos.', 'local-ai': 'O planejamento envia a imagem ao modelo Ollama no servidor somente se ele informar suporte a visão.', azure: 'O planejamento de imagens no Azure está indisponível.', compatible: 'O planejamento envia a imagem ao serviço compatível configurado apenas se o operador ativou visão.', hosted: 'O planejamento de imagens hospedado está indisponível.' },
    choose: 'Escolher imagem', remove: 'Remover imagem', selected: 'Imagem selecionada; ela só será enviada com consentimento ao planejar.', none: 'Nenhuma imagem selecionada.', consent: 'Concordo em enviar esta imagem e seus metadados ao destino acima ao planejar.', invalid: 'Escolha um PNG ou JPEG de até 1 MB.', required: 'Aceite o envio da imagem ou remova-a antes de planejar.', unavailable: 'Imagens não estão disponíveis neste modo. Remova a imagem ou escolha outro modo.',
  },
};

export function createPlanningImageInput(container: HTMLElement, target: () => Target, copilotImages: () => boolean = () => false) {
  container.innerHTML = `<details class="image-input"><summary id="image-title"></summary>
    <p id="image-disclosure"></p><p id="image-destination"></p>
    <input id="image-file" type="file" accept="image/png,image/jpeg" hidden>
    <div class="image-actions"><button type="button" class="button outline" id="image-choose"></button>
    <button type="button" class="button outline" id="image-remove"></button></div>
    <p id="image-status" role="status"></p><label><input id="image-consent" type="checkbox"> <span id="image-consent-text"></span></label>
  </details>`;
  const element = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const fileInput = element<HTMLInputElement>('image-file');
  const consent = element<HTMLInputElement>('image-consent');
  let file: File | undefined;
  let previousTarget = target();
  let previousCopilotImages = copilotImages();
  let invalid = false;
  const refresh = (resetConsent = false) => {
    const text = labels[getLanguage()];
    const currentTarget = target();
    if (resetConsent || previousTarget !== currentTarget || previousCopilotImages !== copilotImages()) consent.checked = false;
    previousTarget = currentTarget;
    previousCopilotImages = copilotImages();
    element('image-title').textContent = text.title;
    element('image-disclosure').textContent = text.disclosure;
    element('image-destination').textContent = currentTarget === 'copilot' && copilotImages()
      ? text.copilotEnabled : text.destination[currentTarget];
    element('image-choose').textContent = text.choose;
    element('image-remove').textContent = text.remove;
    element('image-status').textContent = invalid ? text.invalid : file ? text.selected : text.none;
    element('image-consent-text').textContent = text.consent;
    element<HTMLButtonElement>('image-remove').disabled = !file && !invalid;
    consent.disabled = !file;
  };
  element('image-choose').addEventListener('click', () => fileInput.click());
  element('image-remove').addEventListener('click', () => {
    file = undefined; fileInput.value = ''; consent.checked = false; invalid = false; refresh();
  });
  fileInput.addEventListener('change', () => {
    const selected = fileInput.files?.[0];
    consent.checked = false;
    invalid = !!selected && (!['image/png', 'image/jpeg'].includes(selected.type) || selected.size < 1 || selected.size > 1_000_000);
    file = invalid ? undefined : selected;
    refresh();
  });
  refresh();
  return {
    refresh,
    async take(): Promise<ImagePayload | undefined> {
      const text = labels[getLanguage()];
      if (invalid) throw new Error(text.invalid);
      if (!file) return undefined;
      if (['local', 'azure', 'hosted'].includes(target()) || (target() === 'copilot' && !copilotImages()))
        throw new Error(text.unavailable);
      if (!consent.checked || previousTarget !== target()) throw new Error(text.required);
      const selected = file;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (file !== selected || !consent.checked || previousTarget !== target() || previousCopilotImages !== copilotImages())
        throw new Error(text.required);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      consent.checked = false;
      return { mimeType: selected.type, data: btoa(binary) };
    },
  };
}
