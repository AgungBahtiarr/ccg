import { z } from "zod";
import { Context } from "hono";
import { env } from "hono/adapter";

const sendMessageSchema = z.object({
  phone: z.string(),
  message: z.string(),
});

/**
 * Mengirim pesan melalui Gowa API.
 * @param c - Hono context.
 * @param phone - Nomor tujuan (format internasional).
 * @param message - Isi pesan.
 */
export async function sendWhatsappMessage(
  c: Context,
  phone: string,
  message: string,
): Promise<void> {
  const { GOWA_API_URL, WA_USERNAME, WA_PASSWORD } = env<{
    GOWA_API_URL: string;
    WA_USERNAME: string;
    WA_PASSWORD: string;
  }>(c);

  console.log(`Attempting to send message to ${phone} via ${GOWA_API_URL}`);
  if (!GOWA_API_URL || !WA_USERNAME || !WA_PASSWORD) {
    console.error("Gowa API URL, Username, or Password is not provided.");
    return;
  }

  try {
    const body = sendMessageSchema.parse({ phone, message });
    const authHeader = `Basic ${btoa(WA_USERNAME + ":" + WA_PASSWORD)}`;
    console.log("Sending body:", JSON.stringify(body, null, 2));
    const response = await fetch(`${GOWA_API_URL}/send/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Failed to send message to ${phone}: ${response.status} ${response.statusText}`,
        errorBody,
      );
    } else {
      console.log(`Message sent successfully to ${phone}`);
    }
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

