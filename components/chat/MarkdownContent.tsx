"use client";

// Shared markdown renderer. Used by both the chat interface (live + history)
// and the automations table modal so phase outputs render identically in both
// places (tables, headers, lists, code blocks, etc.).

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChartRenderer } from "@/components/chat/ChartRenderer";

// Stable reference — avoids re-creating on every render which forces
// react-markdown to rebuild the processor pipeline.
const REMARK_PLUGINS = [remarkGfm];

export const MarkdownContent = memo(function MarkdownContent({ content, compact = false }: { content: string; compact?: boolean }) {
    const components = useMemo(() => ({
        code: ({ node, ...props }: any) => {
            const match = /language-(\w+)/.exec((props.className || ''));
            if (match && match[1] === 'chart') {
                return <ChartRenderer jsonString={String(props.children).replace(/\n$/, '')} />;
            }
            return !match ? (
                <code className="bg-muted px-1.5 py-0.5 rounded text-[0.9em] font-mono" {...props} />
            ) : (
                <code className="block font-mono text-xs md:text-sm" {...props} />
            );
        },
        pre: ({ node, ...props }: any) => (
            <pre className="bg-muted/50 p-4 rounded-lg my-3 overflow-x-auto border border-border/50" {...props} />
        ),
        img: ({ node, ...props }: any) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="max-w-full h-auto rounded-lg my-3 border border-border/50 shadow-sm" {...props} alt={props.alt || "Image"} />
        ),
        p: ({ node, ...props }: any) => (
            <p className={`${compact ? 'mb-1.5' : 'mb-3'} last:mb-0 leading-7`} {...props} />
        ),
        a: ({ node, ...props }: any) => (
            <a className="text-primary font-medium hover:underline underline-offset-4" target="_blank" rel="noopener noreferrer" {...props} />
        ),
        ul: ({ node, ...props }: any) => (
            <ul className={`list-disc pl-6 ${compact ? 'mb-1.5' : 'mb-3'} space-y-1.5 marker:text-muted-foreground`} {...props} />
        ),
        ol: ({ node, ...props }: any) => (
            <ol className={`list-decimal pl-6 ${compact ? 'mb-1.5' : 'mb-3'} space-y-1.5 marker:text-muted-foreground`} {...props} />
        ),
        li: ({ node, ...props }: any) => (
            <li className="pl-1" {...props} />
        ),
        blockquote: ({ node, ...props }: any) => (
            <blockquote className="border-l-4 border-primary/30 pl-4 py-1 italic text-muted-foreground my-3 bg-primary/5 rounded-r-md" {...props} />
        ),
        table: ({ node, ...props }: any) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-border max-w-full">
                <table className="w-full text-sm text-left border-collapse" {...props} />
            </div>
        ),
        thead: ({ node, ...props }: any) => (
            <thead className="bg-muted text-muted-foreground uppercase text-xs tracking-wider" {...props} />
        ),
        tbody: ({ node, ...props }: any) => (
            <tbody className="divide-y divide-border/50" {...props} />
        ),
        tr: ({ node, ...props }: any) => (
            <tr className="bg-card/50 hover:bg-muted/50 transition-colors" {...props} />
        ),
        th: ({ node, ...props }: any) => (
            <th className="px-4 py-3 font-medium align-top break-words" {...props} />
        ),
        hr: ({ node, ...props }: any) => (
            <hr className="my-6 border-border/50" {...props} />
        ),
        td: ({ node, ...props }: any) => (
            <td className="px-4 py-3 align-top break-words" {...props} />
        ),
        h1: ({ node, ...props }: any) => (
            <h1 className="text-xl font-bold mt-5 mb-3 text-foreground" {...props} />
        ),
        h2: ({ node, ...props }: any) => (
            <h2 className="text-lg font-semibold mt-4 mb-2 text-foreground border-b border-border/40 pb-1" {...props} />
        ),
        h3: ({ node, ...props }: any) => (
            <h3 className="text-base font-semibold mt-3 mb-2 text-foreground" {...props} />
        ),
        h4: ({ node, ...props }: any) => (
            <h4 className="text-sm font-semibold mt-2 mb-1 text-foreground" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
            <strong className="font-semibold text-foreground" {...props} />
        ),
    }), [compact]);

    return (
        <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            components={components}
        >
            {content}
        </ReactMarkdown>
    );
});
