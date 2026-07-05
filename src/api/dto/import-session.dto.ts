// vendora patch: DTO for the browser-session bridge (Shortcake passkey
// workaround). See VENDORA-PATCHES.md and instance.controller importSession.
export class ImportSessionDto {
  instanceName: string;
  // Baileys AuthenticationCreds serialized with BufferJSON.replacer (a JSON
  // string). This is exactly what exportSession returns for a healthy
  // instance, and what the browser extractor must produce for a flagged one.
  creds: string;
}
