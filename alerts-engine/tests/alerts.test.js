const http = require("http");
const BASE = "http://127.0.0.1:3009";

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on("error", reject);
  });
}

describe("Alerts API", () => {
  test("GET /api/alerts returns array", async () => {
    const r = await get("/api/alerts");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test("alerts have required fields", async () => {
    const r = await get("/api/alerts");
    if (r.body.length > 0) {
      for (const alert of r.body) {
        expect(alert).toHaveProperty("id");
        expect(alert).toHaveProperty("category");
        expect(alert).toHaveProperty("severity");
        expect(alert).toHaveProperty("title");
      }
    }
  });

  test("GET /api/health returns ok", async () => {
    const r = await get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  test("GET /api/health has counts", async () => {
    const r = await get("/api/health");
    expect(r.body).toHaveProperty("counts");
    expect(r.body.counts).toHaveProperty("marine");
    expect(r.body.counts).toHaveProperty("aviation");
  });

  test("GET /api/alerts/marine returns array", async () => {
    const r = await get("/api/alerts/marine");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test("GET /api/alerts/invalid returns 400", async () => {
    const r = await get("/api/alerts/invalid");
    expect(r.status).toBe(400);
  });
});
