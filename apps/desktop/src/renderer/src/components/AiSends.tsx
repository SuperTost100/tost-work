import { useState } from "react";
import { PrivacyDialog } from "@/components/PrivacyDialog";
import { useT } from "@/lib/useT";

/** What a task sends to the AI that's connected, with the link to the privacy notice. Shown wherever an AI gets connected. */
export function AiSends() {
  const t = useT();
  const [privacy, setPrivacy] = useState(false);
  return (
    <p className="lede">
      {t("setup.ai.sends")}{" "}
      <button type="button" className="link" onClick={() => setPrivacy(true)}>
        {t("legal.privacy")}
      </button>
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}
    </p>
  );
}
