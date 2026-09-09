/**
 * 📮 FeWo-direkt-Helfer (§294, Pascal 9.9. 15:33): Gäste mit geernteter Relay-Adresse
 * (…@messages.homeaway.com) bekommen unsere Nachrichten DIREKT per E-Mail an diese Adresse —
 * das ist der FeWo-direkt-Messenger — statt über Smoobu (das FeWo ohnehin nur per Mail zustellt).
 */
export function isFewoRelayEmail(email: string | null | undefined): boolean {
  return /@messages\.homeaway\.com$/i.test((email ?? '').trim())
}
