import { z } from "zod";

const sendMessageSchema = z.object({
  phone: z.string(),
  message: z.string(),
});

/**
 * Mengirim pesan melalui Gowa API.
 * @param phone - Nomor tujuan (format internasional).
 * @param message - Isi pesan.
 * @param gowaApiUrl - URL API Gowa.
 */
export async function sendWhatsappMessage(
  phone: string,
  message: string,
  gowaApiUrl: string,
): Promise<void> {
  console.log(`Attempting to send message to ${phone} via ${gowaApiUrl}`);
  if (!gowaApiUrl) {
    console.error("Gowa API URL is not provided.");
    return;
  }

  try {
    const body = sendMessageSchema.parse({ phone, message });
    console.log("Sending body:", JSON.stringify(body, null, 2));
    const response = await fetch(`${gowaApiUrl}/send/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
