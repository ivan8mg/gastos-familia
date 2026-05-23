export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxt2GkXr4v2-xujmgVvhzd-F3vfGMYJo4jRqqwjp-HB1sinC77AuLQX0Tqgy03nDVea/exec";

  try {
    const body = JSON.stringify(req.body);
    
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "text/plain",
      },
      body: body,
      redirect: "follow",
    });

    const text = await response.text();
    
    try {
      const data = JSON.parse(text);
      res.status(200).json(data);
    } catch {
      res.status(200).send(text);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
