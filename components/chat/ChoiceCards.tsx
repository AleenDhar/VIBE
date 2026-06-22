"use client";

// ── Interactive MCQ cards ────────────────────────────────────────────────────
// The agent appends one or more hidden markers, ONE PER QUESTION:
//   <!--mase-choice {"title":"...","question":"...","options":[...],"multi":bool}-->
// `title` is optional (rendered as a muted prefix, e.g. "Geography Quiz 🌐 :").
// Each marker renders as a self-contained MCQ card (collapsible, with Skip +
// Send response). The marker is an HTML comment, so it's invisible to any client
// that doesn't parse it (graceful degradation for plain markdown rendering).
//
// Visual: a fixed dark card so VIBE and MASE render IDENTICALLY regardless of theme.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Choice {
    title?: string;
    question?: string;
    options: string[];
    multi: boolean;
}

const CHOICE_RE = /<!--\s*mase-choice\s*(\{[\s\S]*?\})\s*-->/gi;

// Strip the hidden markers out of `text` and return both the cleaned prose and the
// parsed choices. Malformed markers are silently skipped.
export function parseChoices(text: string): { text: string; choices: Choice[] } {
    const src = text || "";
    const choices: Choice[] = [];
    const re = new RegExp(CHOICE_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        try {
            const obj = JSON.parse(m[1]);
            if (obj && Array.isArray(obj.options) && obj.options.length) {
                choices.push({
                    title: typeof obj.title === "string" ? obj.title.trim() : undefined,
                    question: typeof obj.question === "string" ? obj.question.trim() : undefined,
                    options: obj.options.map((o: unknown) => String(o)).filter(Boolean),
                    multi: !!obj.multi,
                });
            }
        } catch {
            /* malformed marker → skip it */
        }
    }
    return { text: src.replace(new RegExp(CHOICE_RE.source, "gi"), "").trim(), choices };
}

// One self-contained MCQ card: header (optional muted title + bold question +
// collapse chevron), radio/checkbox option rows, and a Skip / Send response footer.
function ChoiceCard({ choice, onAnswer, disabled }: {
    choice: Choice;
    onAnswer: (t: string) => void;
    disabled: boolean;
}) {
    const [selected, setSelected] = useState<string[]>([]);
    const [done, setDone] = useState<null | "sent" | "skipped">(null);
    const [collapsed, setCollapsed] = useState(false);

    const locked = disabled || done !== null;

    const toggle = (o: string) => {
        if (locked) return;
        if (choice.multi) {
            setSelected((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
        } else {
            setSelected([o]);
        }
    };
    const sendResponse = () => {
        if (locked || !selected.length) return;
        setDone("sent");
        onAnswer(selected.join(choice.multi ? ", " : "; "));
    };
    const skip = () => {
        if (locked) return;
        setDone("skipped");
    };

    return (
        <div className="my-3 rounded-2xl border border-white/10 bg-[#1b1b1e] px-6 py-5 text-left shadow-sm">
            {/* Header: muted title + bold question, collapse chevron on the right */}
            <div className="flex items-start justify-between gap-3">
                <div className="text-[15px] leading-snug">
                    {choice.title ? <span className="font-medium text-zinc-400">{choice.title} : </span> : null}
                    <span className="font-semibold text-white">
                        {choice.question || (choice.multi ? "Select all that apply" : "Pick one")}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-label={collapsed ? "Expand" : "Collapse"}
                    className="-mr-1 mt-0.5 shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-300"
                >
                    {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </button>
            </div>

            {!collapsed && (
                <>
                    {done === "skipped" ? (
                        <div className="mt-3 text-[14px] text-zinc-500">Skipped</div>
                    ) : (
                        <div className="mt-4 flex flex-col">
                            {choice.options.map((o) => {
                                const active = selected.includes(o);
                                return (
                                    <button
                                        key={o}
                                        type="button"
                                        disabled={locked}
                                        onClick={() => toggle(o)}
                                        className={cn(
                                            "flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition",
                                            locked ? "cursor-default" : "hover:bg-white/[0.04]",
                                            done === "sent" && !active ? "opacity-40" : ""
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "grid h-5 w-5 shrink-0 place-items-center border-2 transition",
                                                choice.multi ? "rounded-[6px]" : "rounded-full",
                                                active ? "border-white" : "border-zinc-500"
                                            )}
                                        >
                                            {active ? (
                                                <span className={cn("bg-white", choice.multi ? "h-2.5 w-2.5 rounded-[2px]" : "h-2.5 w-2.5 rounded-full")} />
                                            ) : null}
                                        </span>
                                        <span className="text-[15px] text-zinc-100">{o}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {done === null ? (
                        <div className="mt-5 flex items-center justify-end gap-1">
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={skip}
                                className="rounded-lg px-4 py-2 text-[15px] font-medium text-zinc-400 transition hover:text-white disabled:opacity-40"
                            >
                                Skip
                            </button>
                            <button
                                type="button"
                                disabled={disabled || !selected.length}
                                onClick={sendResponse}
                                className="rounded-lg bg-white px-5 py-2 text-[15px] font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Send response
                            </button>
                        </div>
                    ) : done === "sent" ? (
                        <div className="mt-3 text-[14px] text-zinc-400">Response sent</div>
                    ) : null}
                </>
            )}
        </div>
    );
}

// Renders every MCQ card in a message, stacked. Each card is self-contained
// (its own selection + Skip + Send response).
export function ChoiceCards({ choices, onAnswer, disabled }: {
    choices: Choice[];
    onAnswer: (t: string) => void;
    disabled: boolean;
}) {
    return (
        <div className="flex flex-col">
            {choices.map((c, i) => (
                <ChoiceCard key={i} choice={c} onAnswer={onAnswer} disabled={disabled} />
            ))}
        </div>
    );
}
