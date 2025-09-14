import { Hono } from "hono";
import { executeCommand } from "./handler";
import { sendWhatsappMessage } from "./whatsapp";

// Definisikan tipe untuk environment variables
type Env = {
  GOWA_API_URL: string;
  AUTHORIZED_NUMBER: string;
};

// Gunakan tipe Env pada Hono
const app = new Hono<{ Bindings: Env }>();

interface WebhookPayload {
  phone: string;
  message: string;
  push_name: string;
}

// Endpoint untuk menerima webhook dari Gowa
app.post("/webhook", async (c) => {
  try {
    const payload = await c.req.json<WebhookPayload>();
    const { phone, message, push_name } = payload;

    // Ambil env vars dari context Hono
    const authorizedNumber = c.env.AUTHORIZED_NUMBER;
    const gowaApiUrl = c.env.GOWA_API_URL;

    if (!authorizedNumber || !gowaApiUrl) {
      console.error("GOWA_API_URL or AUTHORIZED_NUMBER are not set.");
      // Jangan teruskan proses jika env vars tidak ada
      return c.json({ error: "Server configuration error" }, 500);
    }

    // Validasi nomor
    if (phone !== authorizedNumber) {
      console.warn(`Unauthorized attempt from number: ${phone}`);
      // Kirim pesan penolakan secara asynchronous
      sendWhatsappMessage(
        phone,
        `Sorry ${push_name}, you are not authorized to use this service.`,
        gowaApiUrl,
      );
      return c.json({ status: "unauthorized" }, 403);
    }

    // Cek apakah pesan adalah command yang valid
    if (!message.startsWith("!")) {
      console.log(`Ignoring non-command message from ${phone}: "${message}"`);
      return c.json({ status: "ok", message: "Not a command" }, 200);
    }

    // Ekstrak command dari pesan
    const command = message.substring(1);

    // Proses command secara asynchronous
    c.executionCtx.waitUntil(
      (async () => {
        console.log(
          `Executing command from ${push_name} (${phone}): ${command}`,
        );
        const result = await executeCommand(command);
        await sendWhatsappMessage(phone, result, gowaApiUrl);
      })(),
    );

    // Langsung balas ke Gowa bahwa webhook sudah diterima
    return c.json({ status: "ok", message: "Webhook received" }, 202);
  } catch (error) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }
});

app.get("/", (c) => {
  return c.text("Bot is running!");
});

console.log("Server is running on port 3000");

export default {
  port: 3000,
  fetch: app.fetch,
};
