// Pure upload wording and rules shared by the browser and the server. No Node imports here, so a
// client component can use it. What the app ACCEPTS is decided by validateUpload() in upload.ts;
// this file only says it out loud (one sentence, everywhere) and decides which of the accepted
// files may satisfy a MANDATORY required document.

/** The one honest sentence about what an upload box takes. It lists exactly what validateUpload() lets in. */
export const ACCEPTED_FILES_HINT =
  "PDF, PNG, JPEG, WebP, DWG, ZIP, XLSX, DOCX, PPTX, CSV or TXT, up to 25 MB";

/**
 * Plain text and CSV have no signature to check, so they are accepted by extension only. That is fine
 * for notes and registers, but it is too weak to stand in for an engineering deliverable.
 */
const NOT_A_DELIVERABLE = new Set(["csv", "txt"]);

/** True when a file of this type may tick off a mandatory required document. */
export function mayFillMandatoryDocument(ext: string): boolean {
  return !NOT_A_DELIVERABLE.has(ext.trim().toLowerCase());
}

/** The refusal a person reads, or null when the file is fine. */
export function mandatoryDocumentProblem(ext: string, requirementName?: string): string | null {
  if (mayFillMandatoryDocument(ext)) return null;
  const subject = requirementName
    ? `"${requirementName}" is a mandatory document, so it`
    : "A mandatory document";
  return (
    `${subject} needs a drawing, a document or an image. ` +
    "Plain text and CSV files can still be attached as ordinary documents."
  );
}
