// PDF处理工具

export interface PDFProcessResult {
  text: string;
  pages: number;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
  };
}

/**
 * 处理PDF文件并提取文本内容
 * @param file PDF文件对象
 * @returns 提取的文本和元数据
 */
export async function processPDFFile(file: File): Promise<PDFProcessResult> {
  // 使用 pdf.js 库处理PDF
  // 注意: 需要安装 pdfjs-dist 包
  const pdfjsLib = await import("pdfjs-dist");

  // 设置worker路径
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let fullText = "";
  const pages = pdf.numPages;

  // 提取每一页的文本
  for (let pageNum = 1; pageNum <= pages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += pageText + "\n\n";
  }

  // 获取元数据
  const metadata = await pdf.getMetadata();
  const info = metadata.info as any;

  return {
    text: fullText.trim(),
    pages,
    metadata: {
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
      keywords: info?.Keywords,
      creator: info?.Creator,
      producer: info?.Producer,
      creationDate: info?.CreationDate,
    },
  };
}

/**
 * 从URL加载PDF并提取文本
 * @param url PDF文件URL
 * @returns 提取的文本和元数据
 */
export async function processPDFFromURL(url: string): Promise<PDFProcessResult> {
  const pdfjsLib = await import("pdfjs-dist");

  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;

  let fullText = "";
  const pages = pdf.numPages;

  for (let pageNum = 1; pageNum <= pages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += pageText + "\n\n";
  }

  const metadata = await pdf.getMetadata();
  const info = metadata.info as any;

  return {
    text: fullText.trim(),
    pages,
    metadata: {
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
      keywords: info?.Keywords,
      creator: info?.Creator,
      producer: info?.Producer,
      creationDate: info?.CreationDate,
    },
  };
}
