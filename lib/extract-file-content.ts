/**
 * Client-side file content extraction utilities.
 * Extracts text from PDF, DOCX, XLSX, CSV, TXT, and MD files in the browser.
 */

/**
 * Extract text content from a File object based on its extension.
 */
export async function extractFileContent(file: File): Promise<string> {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";

    switch (extension) {
        case "txt":
        case "md":
            return extractTextFile(file);
        case "csv":
            return extractTextFile(file);
        case "pdf":
            return extractPdfContent(file);
        case "docx":
        case "doc":
            return extractDocxContent(file);
        case "xlsx":
        case "xls":
        case "xlsm":
            return extractExcelContent(file);
        default:
            console.warn(`Unsupported file type for extraction: .${extension}`);
            return "";
    }
}

/**
 * Read plain text files (TXT, MD, CSV).
 */
async function extractTextFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read text file"));
        reader.readAsText(file);
    });
}

/**
 * Extract text from PDF using pdfjs-dist.
 */
async function extractPdfContent(file: File): Promise<string> {
    try {
        const pdfjsLib = await import("pdfjs-dist");

        // Set the worker source - use unpkg for the exact version
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        const textParts: string[] = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(" ");
            if (pageText.trim()) {
                textParts.push(`[Page ${pageNum}]\n${pageText}`);
            }
        }

        return textParts.join("\n\n");
    } catch (error) {
        console.error("PDF extraction failed:", error);
        return "";
    }
}

/**
 * Extract text from DOCX using mammoth.
 */
async function extractDocxContent(file: File): Promise<string> {
    try {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    } catch (error) {
        console.error("DOCX extraction failed:", error);
        return "";
    }
}

/**
 * Extract text from Excel files (XLSX, XLS) using SheetJS.
 */
async function extractExcelContent(file: File): Promise<string> {
    try {
        const XLSX = await import("xlsx");
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });

        const textParts: string[] = [];

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            // Convert sheet to CSV-like text (readable format)
            const csvText = XLSX.utils.sheet_to_csv(sheet);
            if (csvText.trim()) {
                textParts.push(`[Sheet: ${sheetName}]\n${csvText}`);
            }
        }

        return textParts.join("\n\n");
    } catch (error) {
        console.error("Excel extraction failed:", error);
        return "";
    }
}
