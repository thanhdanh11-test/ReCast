import { VINFAST_CREDIT } from "./vinfastModels";
import { TRAFFIC_MODEL_CREDIT } from './assetModels';
import { useT } from "./i18n";
export function ModelCredits() {
  const t = useT();
  return <details className="model-credits"><summary>{t("Nguồn mô hình xe")}</summary>
    <p>{TRAFFIC_MODEL_CREDIT.title} · {TRAFFIC_MODEL_CREDIT.author} · CC BY 4.0.</p>
    <p className="model-source-url">{TRAFFIC_MODEL_CREDIT.source}</p>
    <p>VinFast VF3 · {VINFAST_CREDIT.author} · CC BY 4.0.</p>
    <p className="model-source-url">{VINFAST_CREDIT.source_url}</p>
    <p>{t("Đã chuẩn hóa trục, đổi vật liệu và tạo LOD. Hình dáng xe là mô hình hiển thị, không phải nhận dạng hãng xe từ nuScenes.")}</p>
    <p className="model-source-url">https://creativecommons.org/licenses/by/4.0/</p>
  </details>;
}
