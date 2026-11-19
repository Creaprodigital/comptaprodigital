import { Socket } from "node:net";
import { AppError } from "@/server/http/errors";
import { env } from "@/server/env";

/**
 * Analyse antivirus des fichiers déposés, par un démon ClamAV (clamd) joignable en TCP
 * (protocole INSTREAM). Facultative : sans CLAMAV_HOST, aucun fichier n'est analysé.
 * Lorsqu'elle est configurée, elle est bloquante : un fichier infecté est refusé, et un
 * dépôt est refusé si l'analyse est impossible (le service ne stocke rien sans analyse).
 */

export type ScanResult = { status: "clean" } | { status: "infected"; signature: string } | { status: "skipped" };

const CHUNK = 64 * 1024;

export function antivirusEnabled(): boolean {
  return Boolean(env().CLAMAV_HOST);
}

/** Envoie le contenu au démon et lit sa réponse (« stream: OK » ou « stream: <signature> FOUND »). */
export async function scanBuffer(bytes: Buffer): Promise<ScanResult> {
  const config = env();
  if (!config.CLAMAV_HOST) return { status: "skipped" };
  const reply = await new Promise<string>((resolve, reject) => {
    const socket = new Socket();
    let data = "";
    socket.setTimeout(30_000, () => socket.destroy(new Error("délai dépassé")));
    socket.on("error", reject);
    socket.on("data", (chunk) => (data += chunk.toString("utf8")));
    socket.on("close", () => resolve(data));
    socket.connect(config.CLAMAV_PORT, config.CLAMAV_HOST!, () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const part = bytes.subarray(offset, offset + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.end(Buffer.alloc(4));
    });
  });
  const text = reply.replace(/\0/g, "").trim();
  if (/^stream: OK$/.test(text)) return { status: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { status: "infected", signature: found[1] };
  throw new Error(`réponse inattendue de l'antivirus : ${text.slice(0, 120)}`);
}

/** Refuse un fichier infecté, ou tout fichier si l'antivirus configuré ne répond pas. */
export async function assertFileIsSafe(bytes: Buffer): Promise<ScanResult> {
  let result: ScanResult;
  try {
    result = await scanBuffer(bytes);
  } catch (error) {
    console.error("[antivirus] analyse impossible", error);
    throw new AppError(503, "ANTIVIRUS_UNAVAILABLE", "L'analyse antivirus est momentanément indisponible : le fichier n'a pas été enregistré. Réessayez dans quelques instants.");
  }
  if (result.status === "infected") {
    throw new AppError(422, "FILE_INFECTED", "Ce fichier contient un programme malveillant identifié par l'antivirus : il a été refusé.");
  }
  return result;
}
