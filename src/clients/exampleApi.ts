import { config } from "../config";

// Stub external API client. Real keys come from SSM in AWS, dummy values locally.
// In tests, mock this module rather than hitting the network.
export async function fetchExample(path: string): Promise<unknown> {
  const res = await fetch(`${config.EXTERNAL_API_ONE_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${config.EXTERNAL_API_ONE_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Example API responded ${res.status}`);
  }
  return res.json();
}
