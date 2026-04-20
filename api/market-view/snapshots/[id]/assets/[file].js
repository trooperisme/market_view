export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ error: "Snapshot images are embedded in generated Vercel reports." });
}
