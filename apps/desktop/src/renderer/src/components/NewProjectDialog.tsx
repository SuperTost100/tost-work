import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { Project } from "../../../shared/model";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

export function NewProjectDialog({
  api,
  open,
  onOpenChange,
  onCreated,
}: {
  api: TostWorkApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    const picked = await api.projects.pickFolder();
    if (!picked) return;
    setFolder(picked);
    // The folder's name is a good first guess for the project's name.
    if (!name.trim()) setName(folderName(picked));
  };

  const create = async () => {
    if (!folder || !name.trim()) return;
    try {
      const project = await api.projects.create({ name: name.trim(), description: description.trim(), folder });
      onCreated(project);
      setName("");
      setDescription("");
      setFolder(null);
      setError(null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg">
          <Dialog.Title className="dlg-title">{t("dialog.newProject")}</Dialog.Title>
          <fieldset className="fld">
            <legend>{t("dialog.folder")}</legend>
            <span className="row">
              <span className={folder ? "fld-path" : "fld-path t3"}>{folder ?? t("dialog.noFolder")}</span>
              <button type="button" className="btn" onClick={choose}>
                {t("dialog.chooseFolder")}
              </button>
            </span>
          </fieldset>
          <label className="fld">
            <span>{t("dialog.name")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="fld">
            <span>{t("dialog.description")}</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {error && <p className="fld-error">{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            <Dialog.Close className="btn">{t("dialog.cancel")}</Dialog.Close>
            <button type="button" className="btn dark" disabled={!folder || !name.trim()} onClick={create}>
              {t("dialog.create")}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
