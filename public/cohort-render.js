import { computeHyperdashSignal } from "./cohort-signal.js";

export function ensureHyperdashDirectionalRead(markdown, normalized) {
  if (!Array.isArray(normalized?.hyperdash_cohorts)) return markdown;
  const heading = "## Hyperdash cohort positioning";
  if (!markdown.includes(heading)) return markdown;

  const signal = computeHyperdashSignal(normalized.hyperdash_cohorts);
  if (!signal) return markdown;
  const conclusion = `**Directional read: ${signal.direction} · ${signal.confidence} confidence**\n\n${signal.reason}`;
  const bodyStart = markdown.indexOf(heading) + heading.length;
  const nextSectionStart = markdown.indexOf("\n## ", bodyStart);
  const sectionEnd = nextSectionStart >= 0 ? nextSectionStart : markdown.length;
  const sectionBody = markdown.slice(bodyStart, sectionEnd);
  const tableStart = sectionBody.search(/\n\| Cohort \|/);

  if (tableStart >= 0) {
    return `${markdown.slice(0, bodyStart)}\n\n${conclusion}\n\n${sectionBody.slice(tableStart).trimStart()}${markdown.slice(sectionEnd)}`;
  }

  return `${markdown.slice(0, bodyStart)}\n\n${conclusion}${markdown.slice(sectionEnd)}`;
}
