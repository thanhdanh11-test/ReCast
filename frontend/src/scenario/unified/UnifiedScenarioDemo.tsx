/** Compatibility export for existing feature tests; routing uses the shared workspace. */
import { ScenarioWorkspace } from "../workspace/ScenarioWorkspace";
import type { DesktopAPI } from "../types";
export function UnifiedScenarioDemo({api,scene}:{api:DesktopAPI;scene?:string;onLibrary:()=>void;onWorkspace?:()=>void}) {
 return <ScenarioWorkspace api={api} scene={scene}/>;
}
