// TASK-423: uploading the nightly backup archive to Google Drive, and pruning old ones.
//
// There is no API key and no service-account key file here. The access token comes from
// src/clients/google-federation.ts, which proves to Google that we are the ECS task role and gets
// a token valid for under an hour. See that file for why.
//
// Deliberately no `googleapis` dependency: the runtime image is `npm ci --omit=dev`, so anything
// added here ships in it forever, and Drive's REST API is three fetch calls.

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export type DriveTarget = {
  accessToken: string;
  folderId: string;
  /**
   * true when folderId is, or lives inside, a Shared Drive.
   *
   * This is not cosmetic. A service account has no Drive storage quota of its own, so a file it
   * would own in an ordinary My Drive folder is rejected outright. A Shared Drive owns its files,
   * which sidesteps that. Shared Drives need Business Standard or above; on the free nonprofit
   * tier this is false and the token must instead be issued for a real user.
   */
  sharedDrive: boolean;
  fetchImpl?: typeof fetch;
};

function withDriveParams(url: URL, sharedDrive: boolean): URL {
  if (sharedDrive) {
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
  }
  return url;
}

/** Upload one file into the backup folder. Returns the new Drive file id. */
export async function uploadFile(
  target: DriveTarget,
  file: { name: string; body: Buffer },
): Promise<string> {
  const doFetch = target.fetchImpl ?? fetch;
  const boundary = `nbcc-${Date.now()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [target.folderId] });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file.body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const url = withDriveParams(new URL(DRIVE_UPLOAD), target.sharedDrive);
  url.searchParams.set("uploadType", "multipart");

  const res = await doFetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}

export type DriveFile = { id: string; name: string; createdTime: string };

/** Every backup currently in the folder, newest first. */
export async function listBackups(target: DriveTarget): Promise<DriveFile[]> {
  const doFetch = target.fetchImpl ?? fetch;
  const url = withDriveParams(new URL(DRIVE_FILES), target.sharedDrive);
  url.searchParams.set("q", `'${target.folderId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id,name,createdTime)");
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("pageSize", "1000");

  const res = await doFetch(url, {
    headers: { authorization: `Bearer ${target.accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  return ((await res.json()).files ?? []) as DriveFile[];
}

export async function deleteFile(target: DriveTarget, fileId: string): Promise<void> {
  const doFetch = target.fetchImpl ?? fetch;
  const url = withDriveParams(new URL(`${DRIVE_FILES}/${fileId}`), target.sharedDrive);
  const res = await doFetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${target.accessToken}` },
  });
  // 404 means it is already gone, which is the state we wanted.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete failed: ${res.status} ${await res.text()}`);
  }
}
