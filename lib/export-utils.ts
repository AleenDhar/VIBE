const parseMarkdownToHtml = (textContext: string, isWord: boolean = false) => {
    let html = textContext.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 1. Extract and format multi-line code blocks
    const codeBlocks: string[] = [];
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const formattedCode = code.replace(/\n/g, '<br/>').replace(/ /g, '&nbsp;');
        codeBlocks.push(`<div style="background:#f8fafc; padding:12pt; font-family:'Courier New', Courier, monospace; font-size:9.5pt; border:1pt solid #e2e8f0; margin-top:6pt; margin-bottom:12pt; border-radius:4px; color:#334155;">${formattedCode}</div>`);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__\n\n`; // Add spacing after block
    });

    // 1.5 Extract and format markdown tables
    const tableBlocks: string[] = [];
    html = html.replace(/(?:^|\n)(\|.*\|(?:\n\|.*\|)+)(?=\n|$)/g, (match, tableContent) => {
        const rows = tableContent.trim().split('\n');
        if (rows.length < 2) return match; // Need at least header + separator
        if (!rows[1].includes('---')) return match; // Second row is usually the dash separator

        let tableHtml = '<table style="border-collapse:collapse; width:100%; border:1pt solid #cbd5e1; margin-bottom:16pt; margin-top:8pt; font-size:10pt; font-family:\'Calibri\', sans-serif;">\n';

        rows.forEach((row: string, rowIndex: number) => {
            if (rowIndex === 1) return; // Skip the markdown separator row ---

            // Get cells, strip outer pipes by filtering empty first/last elements
            let cells = row.split('|').map(c => c.trim());
            if (cells[0] === '') cells.shift();
            if (cells[cells.length - 1] === '') cells.pop();

            tableHtml += '<tr>\n';
            cells.forEach(cell => {
                if (rowIndex === 0) {
                    tableHtml += `<th style="border:1pt solid #cbd5e1; padding:8pt 10pt; background-color:#f1f5f9; text-align:left; color:#0f172a; font-weight:bold;">${cell}</th>\n`;
                } else {
                    tableHtml += `<td style="border:1pt solid #cbd5e1; padding:8pt 10pt; color:#334155;">${cell}</td>\n`;
                }
            });
            tableHtml += '</tr>\n';
        });

        tableHtml += '</table>';
        tableBlocks.push(tableHtml);
        return `__TABLE_BLOCK_${tableBlocks.length - 1}__\n\n`;
    });

    // 2. Inline code
    html = html.replace(/`([^`]+)`/g, '<span style="background:#f1f5f9; font-family:\'Courier New\', Courier, monospace; padding:1.5pt 3pt; border-radius:3pt; border:0.5pt solid #e2e8f0; font-size:10pt; color:#475569;">$1</span>');

    // 3. Headers
    html = html.replace(/^### (.*$)/gim, '<h3 style="font-size:13pt; margin-top:14pt; margin-bottom:6pt; color:#1e293b; font-weight:600;">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:15pt; margin-top:16pt; margin-bottom:8pt; color:#0f172a; border-bottom:1pt solid #cbd5e1; padding-bottom:4pt; font-weight:600;">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:18pt; margin-top:18pt; margin-bottom:10pt; color:#0f172a; font-weight:bold;">$1</h1>');

    // 4. Bold & Italic
    html = html.replace(/\*\*(.*?)\*\*/g, isWord ? '<b>$1</b>' : '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, isWord ? '<i>$1</i>' : '<em>$1</em>');

    // 5. Blockquotes
    html = html.replace(/^>\s+(.*$)/gim, '<div style="border-left:3pt solid #cbd5e1; padding-left:10pt; margin-bottom:10pt; color:#64748b; font-style:italic;">$1</div>');

    // 6. Lists
    // Wrap individual list items
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<ul style="margin-top:0pt; margin-bottom:0pt; padding-left:20pt;"><li style="margin-bottom:4pt; line-height:1.5;">$1</li></ul>');
    html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<ol style="margin-top:0pt; margin-bottom:0pt; padding-left:20pt;"><li style="margin-bottom:4pt; line-height:1.5;">$1</li></ol>');

    // Merge adjacent lists of the same type to prevent Word rendering them as broken separate lists
    html = html.replace(/<\/ul>\n?<ul[^>]*>/g, '');
    html = html.replace(/<\/ol>\n?<ol[^>]*>/g, '');

    // 7. Paragraphs and Line Breaks
    // Split by double newline to identify true paragraphs
    const blocks = html.split('\n\n').map(block => {
        const tBlock = block.trim();
        if (!tBlock) return '';

        // If the block is already a block-level element, leave it alone
        if (tBlock.startsWith('<h') || tBlock.startsWith('<ul') || tBlock.startsWith('<ol') || tBlock.startsWith('<div') || tBlock.startsWith('__CODE_BLOCK_') || tBlock.startsWith('__TABLE_BLOCK_') || tBlock.startsWith('<table')) {
            // If there are internal single newlines inside lists/headers (rare but possible), keep them or br
            if (tBlock.startsWith('<ul') || tBlock.startsWith('<ol')) {
                return tBlock; // lists already handle their own structure
            }
            return tBlock.replace(/\n/g, '<br/>');
        } else {
            // Wrap standard text in a Word paragraph, convert single \n to <br/>
            return `<p style="margin-top:0; margin-bottom:12pt; line-height:1.6; text-align:justify;">${tBlock.replace(/\n/g, '<br/>')}</p>`;
        }
    });

    html = blocks.join('\n');

    // 8. Restore Blocks
    codeBlocks.forEach((cb, i) => {
        html = html.replace(`__CODE_BLOCK_${i}__`, cb);
    });
    tableBlocks.forEach((tb, i) => {
        html = html.replace(`__TABLE_BLOCK_${i}__`, tb);
    });

    return html;
};

export const exportToPDF = async (textContext: string, filename: string = "export.pdf") => {
    try {
        const html2pdf = (await import('html2pdf.js')).default;

        // Use the unified markdown parser
        const htmlContent = parseMarkdownToHtml(textContext, false);

        // 2. Create a clean, detached container
        const container = document.createElement('div');
        container.innerHTML = htmlContent;

        // 3. Apply raw, infallible CSS styles completely isolated from Tailwind
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.fontSize = '11pt';
        container.style.lineHeight = '1.6';
        container.style.color = '#000000';
        container.style.backgroundColor = '#ffffff';
        container.style.padding = '30px';
        container.style.width = '750px';

        const opt = {
            margin: 0.5,
            filename: filename,
            image: { type: 'jpeg' as const, quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const }
        };

        await html2pdf().set(opt).from(container).save();
        return true;
    } catch (error) {
        console.error("PDF export failed:", error);
        return false;
    }
};

export const exportToDocx = async (textContext: string, filename: string = "export.doc") => {
    try {
        // Use the unified markdown parser
        const htmlContent = parseMarkdownToHtml(textContext, true);

        const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset='utf-8'>
            <title>Chat Export</title>
            <style>
                body { 
                    font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; 
                    font-size: 11pt; 
                    color: #334155; 
                    background-color: #ffffff; 
                    padding: 24pt; 
                }
                a { color: #2563eb; text-decoration: underline; }
            </style>
        </head>
        <body>
            <div style="max-width: 800px; margin: 0 auto;">
                ${htmlContent}
            </div>
        </body></html>`;

        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(header);
        const fileDownload = document.createElement("a");
        document.body.appendChild(fileDownload);
        fileDownload.href = source;
        fileDownload.download = filename;
        fileDownload.click();
        document.body.removeChild(fileDownload);
        return true;
    } catch (error) {
        console.error("Docx export failed:", error);
        return false;
    }
};
