import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { fileInputClass } from "@/components/ds/primitives";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { loadSettings } from "../data";
import { uploadSignature } from "../actions";

// Admins only, as before.
export async function SignatureView(sp: SP): Promise<View> {
  const { byKey } = await loadSettings(true);
  const sigInfo = (byKey.get("signature_image") ?? { uploaded: false }) as { uploaded: boolean; uploaded_at?: string };
  return {
    help: <><p>Placed only on Final letters, which only an Admin can issue. Stored privately in Canada and readable by Admins and the Final right only. Never stored in the app&rsquo;s code.</p><p>Admins only. Changes are recorded in the activity log.</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={uploadSignature} className="card space-y-3">
        <p className="text-sm">{sigInfo.uploaded ? <>Uploaded{sigInfo.uploaded_at ? ` ${formatDateTime(sigInfo.uploaded_at)}` : ""}.</> : "Not uploaded yet. Final letters are blocked until it is."}</p>
        {sigInfo.uploaded && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/documents/signature" alt="Current signature" className="h-16 w-auto rounded border border-sand-200 bg-white p-1" />
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="signature" className="label">PNG image, under 1 MB</label>
            <input id="signature" name="signature" type="file" accept="image/png" required className={fileInputClass} />
          </div>
          <button type="submit" className="btn">{sigInfo.uploaded ? "Replace signature" : "Upload signature"}</button>
        </div>
      </form>
    </>,
  };
}
