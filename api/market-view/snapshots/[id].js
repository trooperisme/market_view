import { requireApiAuth } from "../../../lib/auth.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;

  return res.status(404).json({ error: "Server snapshots are not persisted on Vercel yet. Use browser-local snapshots." });
}
