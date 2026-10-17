import { useEffect, useRef, useState } from "react";
import type { DesktopAPI, ImportedEntry, ReactiveCandidates, Scenario, ScenarioGroup } from "../types";
export type Resource = "source" | "map" | "candidates" | "library" | "groups";
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);
/** Shared, independently recoverable resources. Parent source is reused instead of reloaded on navigation. */
export function useScenarioSession(api: DesktopAPI, scene: string, provided?: Scenario | null) {
  const [source, setSource] = useState<Scenario | null>(provided ?? null);
  const [offers, setOffers] = useState<ReactiveCandidates | null>(null);
  const [entries, setEntries] = useState<ImportedEntry[]>([]);
  const [groups, setGroups] = useState<ScenarioGroup[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Resource, string>>>({});
  const [pending, setPending] = useState<Partial<Record<Resource, boolean>>>({});
  const epoch = useRef(0), mounted = useRef(true), sourceRef = useRef(source);
  sourceRef.current = source;
  const tasks = useRef(new Map<Resource, Promise<unknown>>());
  async function resource<T>(key: Resource, operation: () => Promise<T>, accept: (value: T) => void): Promise<T> {
    const current = epoch.current;
    setPending(p => ({...p,[key]:true})); setErrors(p => ({...p,[key]:undefined}));
    const request = operation(); tasks.current.set(key, request);
    try { const value = await request; if (mounted.current && current === epoch.current && tasks.current.get(key) === request) accept(value); return value; }
    catch(e) { if (mounted.current && current === epoch.current && tasks.current.get(key) === request) setErrors(p => ({...p,[key]:errorMessage(e)})); throw e; }
    finally { if (mounted.current && current === epoch.current && tasks.current.get(key) === request) setPending(p => ({...p,[key]:false})); }
  }
  const refreshLibrary = () => resource("library", () => api.listImported(), rows => setEntries(rows.filter(r => r.scene === scene)));
  const refreshGroups = () => resource("groups", () => api.scenarioGroups?.({scene}) ?? Promise.resolve([]), setGroups);
  const loadMap = (src: Scenario) => resource("map", async () => {
    if (!api.mapContext) throw new Error("Không có bộ kiểm tra map.");
    return api.mapContext({source_id:src.id});
  }, context => setMapId(context.map_id));
  const loadCandidates = (src: Scenario) => resource("candidates", () => api.reactiveCandidates({source_id:src.id}), setOffers);
  const loadSource = () => resource("source", () => api.sourceScene({scene}), src => { sourceRef.current=src;setSource(src); });
  async function load() {
    const started=epoch.current;
    void refreshLibrary().catch(() => {}); void refreshGroups().catch(() => {});
    let src = provided;
    if (src === undefined) { try { src = await loadSource(); } catch { return; } }
    if (!src || !mounted.current || started!==epoch.current) return;
    setSource(src); sourceRef.current=src;
    void loadMap(src).catch(() => {}); void loadCandidates(src).catch(() => {});
  }
  async function retry(key: Resource) {
    if (key === "library") return refreshLibrary();
    if (key === "groups") return refreshGroups();
    let src = sourceRef.current;
    if (key === "source" || !src) { src = await loadSource(); await Promise.allSettled([loadMap(src),loadCandidates(src)]); return; }
    return key === "map" ? loadMap(src) : loadCandidates(src);
  }
  async function sourceAction<T>(operation:(sourceId:string)=>Promise<T>):Promise<T> {
    const started=epoch.current,src=sourceRef.current;
    if(!src)throw new Error("Chưa có cảnh nguồn");
    try{return await operation(src.id);}catch(e){
      if(!errorMessage(e).includes("STALE_CONTEXT")||!mounted.current||started!==epoch.current)throw e;
      const fresh=await loadSource();
      if(!mounted.current||started!==epoch.current)throw new Error("CANCELLED");
      void loadMap(fresh).catch(()=>{});void loadCandidates(fresh).catch(()=>{});
      return operation(fresh.id);
    }
  }
  useEffect(() => {
    mounted.current=true;epoch.current++; setOffers(null);setMapId(null);setErrors({});setEntries([]);setGroups([]);setSource(provided ?? null);
    void load();
    return () => {mounted.current=false;epoch.current++;};
  }, [scene,provided?.id]);
  return {source,offers,entries,groups,sourceAction,mapId,errors,pending,refreshLibrary,refreshGroups,retry,
    loading:!!pending.source || !!pending.candidates,
    canCreate:!!source && !!mapId && !errors.map && !errors.source && !pending.map && !pending.source && !pending.candidates && !pending.library};
}
