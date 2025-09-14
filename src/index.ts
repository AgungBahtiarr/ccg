import { Hono } from "hono";
import { executeCommand } from "./handler";
import { sendWhatsappMessage } from "./whatsapp";
import { env } from "hono/adapter";

// Gunakan tipe Env pada Hono
const app = new Hono();

interface WebhookPayload {
  sender_id?: string;
  message?: {
    text?: string;
  };
  pushname?: string;
}

// Endpoint untuk menerima webhook dari Gowa
app.post("/webhook", async (c) => {
  const { AUTHORIZED_NUMBER, GOWA_API_URL } = env<{
    AUTHORIZED_NUMBER: string;
    GOWA_API_URL: string;
  }>(c);
  try {
    const payload = await c.req.json<WebhookPayload>();
    console.log("Received webhook payload:", JSON.stringify(payload, null, 2));

    const phone = payload.sender_id;
    const message = payload.message?.text;
    const push_name = payload.pushname ?? "User";

    console.log(`Parsed data: phone=${phone}, message=${message}, push_name=${push_name}`);

    if (!phone || !message) {
      console.error("Validation failed: Phone or message is missing.");
      return c.json(
        { error: "Invalid payload structure, phone or message is missing" },
        400,
      );
    }

    // Ambil env vars dari context Hono
    const authorizedNumber = AUTHORIZED_NUMBER;
    const gowaApiUrl = GOWA_API_URL;

    if (!authorizedNumber || !gowaApiUrl) {
      console.error("GOWA_API_URL or AUTHORIZED_NUMBER are not set.");
      // Jangan teruskan proses jika env vars tidak ada
      return c.json({ error: "Server configuration error" }, 500);
    }

    // Validasi nomor
    console.log(`Authorizing number: ${phone} against ${authorizedNumber}`);
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
    console.log("Authorization successful.");

    // Cek apakah pesan adalah command yang valid
    if (!message.startsWith("!")) {
      console.log(`Ignoring non-command message from ${phone}: "${message}"`);
      return c.json({ status: "ok", message: "Not a command" }, 200);
    }

    // Ekstrak command dari pesan
    const command = message.substring(1);
    console.log(`Extracted command: ${command}`);

    // Proses command secara synchronous
    console.log(
      `Executing command from ${push_name} (${phone}): ${command}`,
    );
    const result = await executeCommand(command);
    console.log(`Command result: ${result}`);
    await sendWhatsappMessage(phone, result, gowaApiUrl);

    // Balas setelah semua proses selesai
    return c.json({ status: "ok", message: "Command processed" }, 200);
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
