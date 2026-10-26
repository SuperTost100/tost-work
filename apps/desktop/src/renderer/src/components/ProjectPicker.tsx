import { Menu } from "@base-ui/react/menu";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { Project } from "../../../shared/model";

export function ProjectPicker({
  projects,
  value,
  onChange,
  onNewProject,
  allowNone = true,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
  onNewProject: () => void;
  /** Whether "No project", a quick edit, is on offer. Settings can turn quick edit off. */
  allowNone?: boolean;
}) {
  const t = useT();
  const current = projects.find((p) => p.id === value);
  return (
    <Menu.Root>
      <Menu.Trigger className="pick">
        <b>{current?.name ?? t("composer.noProject")}</b>
        <Icon name="down" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start">
          <Menu.Popup className="menu">
            {allowNone && (
              <Menu.Item className="menu-item" onClick={() => onChange(null)}>
                {t("composer.noProject")}
                {value === null && <Icon name="check" className="menu-check" />}
              </Menu.Item>
            )}
            {projects.map((p) => (
              <Menu.Item key={p.id} className="menu-item" onClick={() => onChange(p.id)}>
                {p.name}
                {value === p.id && <Icon name="check" className="menu-check" />}
              </Menu.Item>
            ))}
            <div className="menu-sep" />
            <Menu.Item className="menu-item" onClick={onNewProject}>
              <Icon name="add" />
              {t("picker.newProject")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
