import { useT } from "../i18n";
import type { Assessment } from "./validity";

/** Interpret existing reports without rewriting their validity or stored source evidence. */
export function AssessmentDetails({ assessment, summary }: { assessment: Assessment; summary?: string }) {
    const t = useT();
    return <>
        <p>{t(assessment.explanation)}</p>
        {assessment.reasons.length > 0 && <ul>{assessment.reasons.map((reason, i) => <li key={i}>{t(reason)}</li>)}</ul>}
        {!assessment.sourceRelated && summary && <p>{summary}</p>}
    </>;
}
