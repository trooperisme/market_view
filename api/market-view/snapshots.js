export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    snapshots: [],
    note: "Vercel runtime is stateless; browser-local snapshots are shown by the UI after each run.",
  });
}
