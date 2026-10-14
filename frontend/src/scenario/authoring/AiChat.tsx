import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, TriangleAlert } from "lucide-react";
import { useT } from "../i18n";
import { SUGGESTIONS, delayed, detectType, mockChoose, mockReply, type AiReply, type AiResult, type ChatChoice, type ChatState } from "./mockAi";

type Message = { role: "user"; text: string } | ({ role: "ai" } & AiReply);
const GREETING: AiReply = {
    text: ["Chào bạn! Hãy mô tả tình huống bạn muốn kiểm thử — ai làm gì, tốc độ, khoảng cách, thời tiết. Mình sẽ đề xuất kịch bản để bạn chỉnh tiếp.", {}],
    choices: SUGGESTIONS.map(text => ({ label: text, action: { kind: "prompt", text } })),
};

/** AI tab as a chat (P01 mock): the assistant answers with text and clickable choices; results open in the template. */
export function AiChat({ scene, onOpen }: { scene: string; onOpen: (result: AiResult) => void }) {
    const t = useT();
    const [messages, setMessages] = useState<Message[]>([{ role: "ai", ...GREETING }]);
    const [state, setState] = useState<ChatState>({ result: null, prompts: [] });
    const [draft, setDraft] = useState("");
    const [typing, setTyping] = useState(false);
    const live = useRef(0);
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => () => { live.current++; }, []);
    useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages, typing]);
    const tv = (vars: Record<string, string | number> = {}) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "string" ? t(v) : v]));

    const respond = (user: string | null, reply: () => AiReply, next: (reply: AiReply) => ChatState) => {
        const ticket = ++live.current;
        if (user !== null) setMessages(m => [...m, { role: "user", text: user }]);
        setTyping(true);
        void delayed(reply).then(r => {
            if (live.current !== ticket) return;
            setTyping(false);
            setMessages(m => [...m, { role: "ai", ...r }]);
            setState(next(r));
        });
    };
    const send = (text: string) => {
        const message = text.trim();
        if (!message || typing) return;
        setDraft("");
        // A message naming a type starts a new scenario; anything else refines it (or waits for a type choice).
        const fresh = Boolean(detectType(message));
        respond(message, () => mockReply(message, scene, state), r => ({
            result: r.result ?? state.result,
            prompts: fresh ? [message] : r.result || !state.result ? [...state.prompts, message] : state.prompts,
        }));
    };
    const choose = (choice: ChatChoice) => {
        const action = choice.action;
        if (action.kind === "open") { if (state.result) onOpen(state.result); return; }
        if (action.kind === "prompt") { send(t(action.text)); return; }
        if (typing) return;
        respond(t(choice.label, choice.vars), () => mockChoose(action, scene, state), r => ({ result: r.result ?? state.result, prompts: state.prompts }));
    };
    const latest = messages.length - 1;

    return <div className="authoring-chat">
        <div className="chat-log" role="log" aria-label={t("Hội thoại với AI")} aria-live="polite">
            {messages.map((m, i) => m.role === "user"
                ? <div key={i} className="chat-msg user"><p>{m.text}</p></div>
                : <div key={i} className="chat-msg ai">
                    <span className="chat-avatar" aria-hidden><Sparkles size={14}/></span>
                    <div className="chat-body">
                        <p>{t(m.text[0], tv(m.text[1]))}</p>
                        {m.result && <section className="chat-result" aria-label={t("Kết quả AI")}>
                            <div className="authoring-ai-type">
                                <m.result.type.icon size={18} aria-hidden/>
                                <div><strong>{t(m.result.type.name)}</strong><small>{t(m.result.type.summary)}</small></div>
                                <span className={`chip ${m.result.confidence >= 0.7 ? "ok" : "warn"}`}>{t("Độ tin cậy {n}%", { n: Math.round(m.result.confidence * 100) })}</span>
                            </div>
                            <ul className="authoring-ai-list">{m.result.understood.map(([k, v], j) => <li key={j}>{t(k, tv(v))}</li>)}</ul>
                            {m.result.assumptions.length > 0 && <ul className="authoring-ai-list warn">{m.result.assumptions.map(([k, v], j) => <li key={j}><TriangleAlert size={12} aria-hidden/>{t(k, tv(v))}</li>)}</ul>}
                        </section>}
                        {m.choices.length > 0 && <div className="chat-choices" role="group" aria-label={t("Lựa chọn")}>
                            {m.choices.map((c, j) => <button key={j} className={`chip${c.action.kind === "open" ? " chat-primary" : ""}`} disabled={i !== latest || typing} onClick={() => choose(c)}>{t(c.label, c.vars)}</button>)}
                        </div>}
                    </div>
                </div>)}
            {typing && <div className="chat-msg ai"><span className="chat-avatar" aria-hidden><Sparkles size={14}/></span><div className="chat-typing" aria-label={t("AI đang trả lời")}><i/><i/><i/></div></div>}
            <div ref={end}/>
        </div>
        <form className="chat-composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
            <textarea aria-label={t("Nhắn cho AI")} rows={2} maxLength={2000} value={draft} placeholder={t("Mô tả tình huống, ví dụ: xe con cắt làn trước ego ở 60 km/h…")}
                onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}/>
            <button type="submit" className="primary icon-button" aria-label={t("Gửi")} disabled={!draft.trim() || typing || !scene}><ArrowUp size={16} aria-hidden/></button>
        </form>
        <small className="chat-note">{t("Bản xem trước: AI đang được mô phỏng bằng luật từ khoá, chưa gọi mô hình thật.")}</small>
    </div>;
}
