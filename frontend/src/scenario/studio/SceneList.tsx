import { useT } from "../i18n";
import type { Scene } from "../types";

/** Scene list of the "Cảnh nguồn" drawer and the Studio left column (plan50 P01 §2). With `mapErrors`, a scene whose
 * map the creation gate rejects is greyed out and cannot be opened (its reason is the tooltip). */
export function SceneList({ scenes, current, disabled, mapErrors, onOpen }: {
    scenes: Scene[]; current: string; disabled: boolean; mapErrors?: Record<string, string | null>; onOpen: (row: Scene) => void;
}) {
    const t = useT();
    return <ul className="scene-list" aria-label={t("Danh sách cảnh")}>
        {scenes.map(row => {
            const error = mapErrors?.[row.scene] ?? null;
            return <li key={row.scene}><button aria-current={row.scene === current ? "true" : undefined} disabled={disabled || !!error}
                className={error ? "scene-map-error" : undefined} title={error ?? undefined} onClick={() => onOpen(row)}>
                <strong>{row.scene}</strong>
                <small>{error ? t("map lỗi, không tạo được kịch bản") : `${row.duration_s.toFixed(1).replace(".", ",")} s · ${t("{n} đối tượng", { n: row.tracks.length })}`}</small>
            </button></li>;
        })}
    </ul>;
}
