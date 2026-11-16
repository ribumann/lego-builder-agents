import { getLanguage, type Language } from './i18n';

type Target = 'local' | 'copilot' | 'azure' | 'compatible' | 'hosted';
type ImagePayload = { mimeType: string; data: string };
type Labels = {
  title: string; disclosure: string; destination: Record<Target, string>; azureUnavailable: string; copilotEnabled: string; copilotDestination: string; choose: string; remove: string;
  selected: string; none: string; consent: string; invalid: string; required: string; unavailable: string;
};

const labels: Record<Language, Labels> = {
  en: {
    copilotDestination: 'Planning sends this image and its metadata to GitHub and may consume quota.',
    copilotEnabled: 'Planning sends this image and its metadata to GitHub through the Windows Copilot CLI and may consume quota. Windows containment and private storage are checked for each request; model vision support and accuracy are unverified.',
    title: 'Optional reference image', disclosure: 'Choose a PNG or JPEG up to 1 MB. The original file can contain location, camera or other metadata; it is not stripped. Only choose an image you have permission to share.',
    destination: { local: 'Offline templates cannot use images.', copilot: 'Copilot image planning is unavailable until attachment process-tree safety is verified.', azure: 'Planning sends this image and your brief to Azure Foundry only after you consent and select Plan. Original metadata is not removed.', compatible: 'Planning sends the image to the configured compatible service only if its operator enabled vision.', hosted: 'Hosted Azure image planning is not enabled on this server.' },
    azureUnavailable: 'Azure image planning is unavailable on this server.',
    choose: 'Choose image', remove: 'Remove image', selected: 'Image selected; it is not sent until you consent and plan.', none: 'No image selected.', consent: 'I consent to send this image and its metadata to the destination above when I plan.', invalid: 'Choose a PNG or JPEG no larger than 1 MB.', required: 'Consent to send the selected image or remove it before planning.', unavailable: 'Images are unavailable for this planning mode. Remove the image or choose another mode.',
  },
  de: {
    copilotDestination: 'Die Planung sendet dieses Bild und seine Metadaten an GitHub und kann Kontingent verbrauchen.',
    copilotEnabled: 'Die Planung sendet dieses Bild und seine Metadaten über die Windows-Copilot-CLI an GitHub und kann Kontingent verbrauchen. Windows-Prozessisolierung und privater Speicher werden bei jeder Anfrage geprüft; Bildunterstützung und Genauigkeit des Modells sind nicht verifiziert.',
    title: 'Optionales Referenzbild', disclosure: 'Wähle ein PNG oder JPEG bis 1 MB. Die Originaldatei kann Standort-, Kamera- oder andere Metadaten enthalten; sie werden nicht entfernt. Teile nur Bilder, für die du eine Erlaubnis hast.',
    destination: { local: 'Offline-Vorlagen können keine Bilder verwenden.', copilot: 'Copilot-Bildplanung ist nicht verfügbar, bis die Sicherheit des Prozessbaums für Anhänge geprüft ist.', azure: 'Die Planung sendet dieses Bild und deinen Auftrag erst nach deiner Zustimmung und Auswahl von „Planen“ an Azure Foundry. Originalmetadaten werden nicht entfernt.', compatible: 'Die Planung sendet das Bild nur an den konfigurierten Dienst, wenn dessen Betreiber Bildverarbeitung aktiviert hat.', hosted: 'Die gehostete Azure-Bildplanung ist auf diesem Server nicht aktiviert.' },
    azureUnavailable: 'Azure-Bildplanung ist auf diesem Server nicht verfügbar.',
    choose: 'Bild wählen', remove: 'Bild entfernen', selected: 'Bild ausgewählt; es wird erst mit Zustimmung und Planung gesendet.', none: 'Kein Bild ausgewählt.', consent: 'Ich stimme zu, dieses Bild und seine Metadaten beim Planen an das obige Ziel zu senden.', invalid: 'Wähle ein PNG oder JPEG mit höchstens 1 MB.', required: 'Stimme dem Senden des Bildes zu oder entferne es vor der Planung.', unavailable: 'Bilder sind in diesem Planungsmodus nicht verfügbar. Entferne das Bild oder wähle einen anderen Modus.',
  },
  fr: {
    copilotDestination: 'La planification envoie cette image et ses métadonnées à GitHub et peut consommer du quota.',
    copilotEnabled: 'La planification envoie cette image et ses métadonnées à GitHub via la CLI Copilot Windows et peut consommer du quota. Le confinement Windows et le stockage privé sont vérifiés à chaque requête ; la vision et la précision du modèle ne sont pas vérifiées.',
    title: 'Image de référence facultative', disclosure: 'Choisissez un PNG ou JPEG de 1 Mo maximum. Le fichier original peut contenir des métadonnées de lieu, appareil ou autres ; elles ne sont pas supprimées. Partagez seulement une image autorisée.',
    destination: { local: 'Les modèles hors ligne ne prennent pas les images.', copilot: 'Les images Copilot sont indisponibles tant que la sécurité des processus liés aux pièces jointes n’est pas vérifiée.', azure: 'Cette image et votre consigne seront envoyées à Azure Foundry uniquement après votre accord et le choix de Planifier. Les métadonnées d’origine ne sont pas supprimées.', compatible: 'La planification envoie l’image au service compatible configuré seulement si son exploitant a activé la vision.', hosted: 'La planification d’image Azure hébergée n’est pas activée sur ce serveur.' },
    azureUnavailable: 'La planification d’image Azure est indisponible sur ce serveur.',
    choose: 'Choisir une image', remove: 'Retirer l’image', selected: 'Image sélectionnée ; elle ne sera envoyée qu’avec votre accord et la planification.', none: 'Aucune image sélectionnée.', consent: 'J’accepte d’envoyer cette image et ses métadonnées à la destination ci-dessus lors de la planification.', invalid: 'Choisissez un PNG ou JPEG de 1 Mo maximum.', required: 'Acceptez l’envoi de l’image ou retirez-la avant de planifier.', unavailable: 'Les images sont indisponibles pour ce mode. Retirez l’image ou choisissez un autre mode.',
  },
  it: {
    copilotDestination: 'La pianificazione invia questa immagine e i metadati a GitHub e può consumare quota.',
    copilotEnabled: 'La pianificazione invia questa immagine e i metadati a GitHub tramite la CLI Copilot Windows e può consumare quota. Isolamento Windows e archivio privato sono controllati a ogni richiesta; supporto visivo e precisione del modello non sono verificati.',
    title: 'Immagine di riferimento facoltativa', disclosure: 'Scegli un PNG o JPEG fino a 1 MB. Il file originale può contenere posizione, fotocamera o altri metadati; non vengono rimossi. Condividi solo immagini autorizzate.',
    destination: { local: 'I modelli offline non usano immagini.', copilot: 'Le immagini Copilot non sono disponibili finché non è verificata la sicurezza dei processi degli allegati.', azure: 'L’immagine e la tua richiesta saranno inviate ad Azure Foundry solo dopo il consenso e la selezione di Pianifica. I metadati originali non vengono rimossi.', compatible: 'La pianificazione invia l’immagine al servizio compatibile configurato solo se il gestore ha abilitato la visione.', hosted: 'La pianificazione con immagini Azure ospitata non è abilitata su questo server.' },
    azureUnavailable: 'La pianificazione con immagini Azure non è disponibile su questo server.',
    choose: 'Scegli immagine', remove: 'Rimuovi immagine', selected: 'Immagine selezionata; sarà inviata solo con il consenso e la pianificazione.', none: 'Nessuna immagine selezionata.', consent: 'Acconsento a inviare immagine e metadati alla destinazione sopra durante la pianificazione.', invalid: 'Scegli un PNG o JPEG di massimo 1 MB.', required: 'Acconsenti all’invio dell’immagine o rimuovila prima di pianificare.', unavailable: 'Le immagini non sono disponibili in questa modalità. Rimuovi l’immagine o scegli un’altra modalità.',
  },
  es: {
    copilotDestination: 'La planificación envía esta imagen y sus metadatos a GitHub y puede consumir cuota.',
    copilotEnabled: 'La planificación envía esta imagen y sus metadatos a GitHub mediante la CLI de Copilot para Windows y puede consumir cuota. El aislamiento de Windows y el almacenamiento privado se comprueban en cada solicitud; la visión y precisión del modelo no están verificadas.',
    title: 'Imagen de referencia opcional', disclosure: 'Elige un PNG o JPEG de hasta 1 MB. El archivo original puede contener ubicación, cámara u otros metadatos; no se eliminan. Comparte solo imágenes autorizadas.',
    destination: { local: 'Las plantillas sin conexión no usan imágenes.', copilot: 'Las imágenes de Copilot no están disponibles hasta verificar la seguridad de los procesos de los adjuntos.', azure: 'La imagen y tus instrucciones se enviarán a Azure Foundry solo después de tu consentimiento y de elegir Planificar. No se eliminan los metadatos originales.', compatible: 'La planificación envía la imagen al servicio compatible configurado solo si su operador activó visión.', hosted: 'La planificación de imágenes de Azure alojada no está habilitada en este servidor.' },
    azureUnavailable: 'La planificación de imágenes de Azure no está disponible en este servidor.',
    choose: 'Elegir imagen', remove: 'Quitar imagen', selected: 'Imagen seleccionada; solo se enviará con consentimiento al planificar.', none: 'No hay imagen seleccionada.', consent: 'Acepto enviar esta imagen y sus metadatos al destino indicado al planificar.', invalid: 'Elige un PNG o JPEG de 1 MB como máximo.', required: 'Acepta el envío de la imagen o quítala antes de planificar.', unavailable: 'Las imágenes no están disponibles en este modo. Quita la imagen o elige otro modo.',
  },
  pt: {
    copilotDestination: 'O planejamento envia esta imagem e seus metadados ao GitHub e pode consumir cota.',
    copilotEnabled: 'O planejamento envia esta imagem e seus metadados ao GitHub pela CLI do Copilot para Windows e pode consumir cota. O isolamento Windows e o armazenamento privado são verificados a cada solicitação; visão e precisão do modelo não foram verificadas.',
    title: 'Imagem de referência opcional', disclosure: 'Escolha um PNG ou JPEG de até 1 MB. O arquivo original pode conter localização, câmera ou outros metadados; eles não são removidos. Compartilhe apenas imagens autorizadas.',
    destination: { local: 'Modelos offline não usam imagens.', copilot: 'Imagens no Copilot estão indisponíveis até verificar a segurança dos processos de anexos.', azure: 'A imagem e suas instruções serão enviadas ao Azure Foundry somente após seu consentimento e a seleção de Planejar. Os metadados originais não são removidos.', compatible: 'O planejamento envia a imagem ao serviço compatível configurado apenas se o operador ativou visão.', hosted: 'O planejamento de imagens do Azure hospedado não está habilitado neste servidor.' },
    azureUnavailable: 'O planejamento de imagens no Azure não está disponível neste servidor.',
    choose: 'Escolher imagem', remove: 'Remover imagem', selected: 'Imagem selecionada; ela só será enviada com consentimento ao planejar.', none: 'Nenhuma imagem selecionada.', consent: 'Concordo em enviar esta imagem e seus metadados ao destino acima ao planejar.', invalid: 'Escolha um PNG ou JPEG de até 1 MB.', required: 'Aceite o envio da imagem ou remova-a antes de planejar.', unavailable: 'Imagens não estão disponíveis neste modo. Remova a imagem ou escolha outro modo.',
  },
};

export function createPlanningImageInput({ container, chooser, privacy, target, copilotImages, azureImages, compatibleDestination, compatibleImages }: {
  container: HTMLElement; chooser: HTMLButtonElement; privacy: HTMLElement;
  target: () => Target; copilotImages: () => boolean; azureImages: () => boolean;
  compatibleDestination: () => string | null; compatibleImages: () => boolean;
}) {
  privacy.innerHTML = '<h3 id="image-title"></h3><p id="image-disclosure"></p><p id="image-provider-details"></p>';
  container.classList.add('image-input');
  container.innerHTML = `
    <input id="image-file" type="file" accept="image/png,image/jpeg" hidden>
    <div id="image-chip" class="attachment-chip" hidden><span id="image-name"></span>
      <button type="button" class="composer-tool" id="image-remove"><span aria-hidden="true">&times;</span></button>
    </div>
    <p id="image-status" role="status" hidden></p>
    <div id="image-permission" hidden><p id="image-destination"></p>
      <label><input id="image-consent" type="checkbox" aria-describedby="image-destination"> <span id="image-consent-text"></span></label>
    </div>`;
  const element = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const fileInput = element<HTMLInputElement>('image-file');
  const consent = element<HTMLInputElement>('image-consent');
  let file: File | undefined;
  let previousTarget = target();
  let previousCopilotImages = copilotImages();
  let previousAzureImages = azureImages();
  let previousCompatibleDestination = compatibleDestination();
  let previousCompatibleImages = compatibleImages();
  let invalid = false;
  const targetAvailable = () => {
    const currentTarget = target();
    return currentTarget !== 'local' && currentTarget !== 'hosted'
      && (currentTarget !== 'copilot' || copilotImages())
      && (currentTarget !== 'azure' || azureImages())
      && (currentTarget !== 'compatible' || (!!compatibleDestination() && compatibleImages()));
  };
  const refresh = (resetConsent = false) => {
    const text = labels[getLanguage()];
    const currentTarget = target();
    const currentAzureImages = azureImages();
    if (resetConsent || previousTarget !== currentTarget || previousCopilotImages !== copilotImages() || previousAzureImages !== currentAzureImages
      || previousCompatibleDestination !== compatibleDestination() || previousCompatibleImages !== compatibleImages()) consent.checked = false;
    previousTarget = currentTarget;
    previousCopilotImages = copilotImages();
    previousAzureImages = currentAzureImages;
    previousCompatibleDestination = compatibleDestination();
    previousCompatibleImages = compatibleImages();
    privacy.querySelector<HTMLElement>('#image-title')!.textContent = text.title;
    privacy.querySelector<HTMLElement>('#image-disclosure')!.textContent = text.disclosure;
    let destination = currentTarget === 'azure' && !currentAzureImages ? text.azureUnavailable
      : currentTarget === 'copilot' && copilotImages() ? text.copilotEnabled : text.destination[currentTarget];
    if (currentTarget === 'compatible') destination += ` ${compatibleDestination() ?? 'Not configured'}`;
    privacy.querySelector<HTMLElement>('#image-provider-details')!.textContent = destination;
    element('image-destination').textContent = currentTarget === 'copilot' && copilotImages()
      ? text.copilotDestination : destination;
    chooser.setAttribute('aria-label', text.choose);
    chooser.title = text.choose;
    element('image-remove').setAttribute('aria-label', text.remove);
    element('image-remove').title = text.remove;
    element('image-chip').hidden = !file && !invalid;
    element('image-name').textContent = fileInput.files?.[0]?.name ?? '';
    element('image-name').title = fileInput.files?.[0]?.name ?? '';
    element('image-permission').hidden = !file;
    element('image-status').hidden = !file && !invalid;
    element('image-status').classList.toggle('image-error', invalid);
    element('image-status').textContent = invalid ? text.invalid : file ? text.selected : text.none;
    element('image-consent-text').textContent = text.consent;
    element<HTMLButtonElement>('image-remove').disabled = !file && !invalid;
    consent.disabled = !file || !targetAvailable();
  };
  chooser.addEventListener('click', () => fileInput.click());
  element('image-remove').addEventListener('click', () => {
    file = undefined; fileInput.value = ''; consent.checked = false; invalid = false; refresh(); chooser.focus();
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
      if (!targetAvailable())
        throw new Error(text.unavailable);
      if (!consent.checked || previousTarget !== target()) throw new Error(text.required);
      const selected = file;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (file !== selected || !consent.checked || previousTarget !== target()
        || previousCopilotImages !== copilotImages() || previousAzureImages !== azureImages()
        || previousCompatibleDestination !== compatibleDestination() || previousCompatibleImages !== compatibleImages())
        throw new Error(text.required);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      consent.checked = false;
      return { mimeType: selected.type, data: btoa(binary) };
    },
  };
}
