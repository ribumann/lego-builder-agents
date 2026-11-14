export function copilotAuthenticationFailed(output) {
  return output.split(/\r?\n/).some(line => {
    let event;
    try { event = JSON.parse(line); } catch { return false; }
    if (event?.type !== 'session.error') return false;
    const type = typeof event.data?.errorType === 'string' ? event.data.errorType : '';
    const message = typeof event.data?.message === 'string' ? event.data.message : '';
    return /authenticat|not logged|login required|copilot login|unauthorized|401\b/i.test(`${type}\n${message}`);
  });
}

export function readCopilotResponse(output) {
  let content;
  let completed = false;
  for (const line of output.trim().split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error('Copilot CLI returned invalid JSONL. Update the standalone CLI; no build was started and BrickLab did not retry.'); }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || completed)
      throw new Error('Copilot CLI returned an unexpected event stream. No build was started and BrickLab did not retry.');
    if (event.type === 'session.error')
      throw new Error('Copilot reported a session error. Check CLI authentication, account access and network availability; no build was started.');
    if (event.type === 'assistant.message') {
      if (typeof event.data?.content !== 'string')
        throw new Error('Copilot CLI returned an invalid assistant message. No build was started.');
      content = event.data.content;
      if (Buffer.byteLength(content) > 128_000)
        throw new Error('Copilot final response exceeded the size limit.');
    }
    if (event.type === 'result') {
      if (event.exitCode !== 0)
        throw new Error('Copilot did not complete successfully. No build was started and BrickLab did not retry.');
      completed = true;
    }
  }
  if (!completed || content === undefined)
    throw new Error('Copilot CLI returned an incomplete response. No build was started and BrickLab did not retry.');
  return content;
}
