# Agent Note: 没有文本层的附件由本地 OCR 读取

Status: implemented

[English](2026-11-24-attachment-local-ocr.md) | 中文

## 问题

附件摄取只用 `anydoc` 转换文档，没有别的路径，于是两种真实的邮件情形一直读不到。页面是图片的 PDF 会让转换器以 3 退出（`needsOcr`）；在 `ocr: 'reject'` 下该附件被当作"sin texto extraíble"丢弃，而 `hosted` 路径需要部署里并不存在的 `FIRECRAWL_API_KEY`。图片连转换都到不了：`formatForAttachment` 不认识任何图片扩展名，于是一张采购清单照片被报告为 `unsupported`。邮件读取器有意保留内嵌图片（`imap.ts`）留给消费者，可那个消费者并不存在；`deepseek-flash` 看不到图片，因此也没有视觉路径。OCR 路径上线后又出现第三种情形：页面是扫描图片的 Word、Excel 或 PowerPoint 文件。`anydoc` 打开包后找不到文本，该附件变成 `empty`，也没有任何东西指出缺少的渲染器。

## 决定

用 **本地 OCR** 读取没有文本层的附件，走子进程接缝，尽力而为，并把 `hosted` 留给愿意买密钥的部署。

- `packages/faberloom/inbound/src/ocr.ts` 同时拥有两条路径，每一页都按同一顺序走三步。`straighten` 通过子进程接缝运行 `deploy/ocr/ocr-tools.py deskew`：助手在 -12 到 12 度之间搜索能把墨迹集中到最少行上的旋转角，角度小于 0.5 度或没有 Python 时原样返回页面。`recognize` 随后运行 `tesseract <page> stdout -l spa+eng --psm 3 tsv`，从词行重建文本并保留其置信度中位数；在实测的两份真实文档上，这种重建与纯文本渲染器的输出逐字节相同。中位数低于 75 时，该页用 RapidOCR（`ocr-tools.py rapid`）重读一次；它每个进程都要加载 ONNX 模型，因此 `readPages` 把一份文档里所有弱页收进一次调用。`ocrPdf` 用 `pdftoppm -r 200 -png` 把 PDF 渲染到临时目录，并以 `--- página N ---` 标记页码。两者都通过 `SubprocessRuntime.spawn` 启动（无 shell，无 `node:child_process`），用 `resolveExecutable` 解析二进制，且从不向调用方抛出。
- 上限是显式的，每一条都有理由：每个附件 25 MB（既有的 `MAX_INPUT_BYTES`）、每个 PDF 10 页、一次 Tesseract 运行 20 秒、一页的端正 20 秒、一次 RapidOCR 批处理 90 秒、每个 PDF 180 秒、保留 200 KB 文本。失败、超时或受保护的 PDF 都返回已收集的文本或停止的原因，与今天转换器的行为一致。
- `packages/faberloom/inbound/src/documents.ts` 在转换之前先分类：`IMAGES` 把位图扩展名映射为媒体类型，文件名没有可用扩展名时（贴在邮件里的内嵌图片）由声明的 `mediaType` 决定。图片走 `ocrImage`，否则报告 `ocr-disabled`；它永远不送给 `anydoc`，后者没有图片路径，只会给出一次假失败。文档先走 `anydoc`；它的文本存在时就以它为准，而转换器没给出文本的 PDF 回退到 `ocrPdf`。
- `packages/faberloom/inbound/src/office.ts` 覆盖扫描版 Office 文件。`ocrOffice` 按附件自己的扩展名写出字节，用独立的 `-env:UserInstallation` 配置目录运行 `libreoffice --headless --norestore --convert-to pdf --outdir <scratch>`（共用配置目录只有一把锁，同一趟里的两个附件否则会互相冲突），在 50 MB 上限内读回生成的 PDF，再交给 `ocrPdf`。在 `local` 下 `anydoc` 没给出文本时，`documents.ts` 对 `doc`、`docx`、`xls`、`xlsx`、`ppt`、`pptx`、`odt`、`ods`、`odp` 与 `rtf` 回退到它；`xls` 以自己的别名加入 `FORMATS`。上限：转换 60 秒、整个尝试 150 秒、生成的 PDF 50 MB，临时目录在成功与失败时都删除。没有 LibreOffice 报告 `converter-missing`；非零退出、没有 PDF 或空 PDF 报告 `failed`，由 `documents.ts` 呈现为 `ocr-failed`。
- `AttachmentSkipReason` 新增 `ocr-disabled` 与 `ocr-failed`，读取方因此能区分"这个部署没有 OCR"和"OCR 跑了但什么都没读到"。`tool-faberloom` 把两者都渲染成面向模型的原因说明。
- 配置：`FABERLOOM_OCR`（`off` | `local` | `hosted`）就是开关，即 `tool-faberloom` 与 `faberloom-view` 的 `ocr` 字段，代码默认 `off`。网关用 `FABERLOOM_OCR` 在两行都写出该字段——默认 `local`，未知值以与非法工具模式相同的 FATAL 行中止启动——而 `ANYDOC_OCR` 仍只控制转换器自己的 hosted 路径。`resolveOcrMode` 也接受 `anydocOcr` 里的 `local`，因此先于该字段写出的 profile 继续可用；显式的 `ocr` 优先。
- `Dockerfile` 在同一层 `apt-get` 里安装 OCR 包（`tesseract-ocr`、`tesseract-ocr-spa`、`tesseract-ocr-eng`、`poppler-utils`：69 个包、38.4 MB 下载、115 MB 磁盘），以及为 Office 文档准备的 `libreoffice-writer`、`libreoffice-calc`、`libreoffice-impress` 与 `fonts-liberation`：171 个包、154 MB 下载、506 MB 额外磁盘，镜像因此从 329 MB 变成 991 MB。`fonts-liberation` 保持 Arial 的度量，写在 Arial 里的文档在 OCR 读它的列之前不会回流成 DejaVu。第二个 `RUN` 安装 `python3-pip`，并把 `rapidocr-onnxruntime` 连同 `onnxruntime`、`opencv-python-headless`、`numpy`、`Pillow`、`shapely`、`pyclipper`、`six`、`PyYAML` 装进 `/opt/ocr/py`：实测 350 MB 磁盘。用 `opencv-python-headless` 而不是 `opencv-python` 是 137 MB 而不是 203 MB，读数完全相同。`COPY deploy/ocr/ /opt/ocr/` 交付助手脚本。容器不新增任何 capability。

## 备选方案

**只用 hosted OCR。** `anydoc --ocr hosted` 已经存在，但部署里没有 Firecrawl 密钥，每一页都要花钱，而且一张采购单会离开基础设施。owner 的决定正相反：文档留在这里。

**视觉模型。** `deepseek-flash` 看不到图片，部署里也没有任何服务商密钥；视觉服务会是第二个外部依赖，并在业务文档上带来数据分级问题。

**OCR 渲染页面，而不是读 PDF 文本层。** `pdftotext` 比渲染加识别更便宜，但混合型 PDF 仍需要逐页判断，而只要存在文本层，`anydoc` 已经产出更好的 Markdown（标题、表格）。

**让图片保持 `unsupported`。** 读取器有意保留内嵌图片，产品也要求"一张清单的照片"；把一个已支持的情形报告成不支持的格式，会掩盖部署现在具备的能力。

**在旁挂容器里转换 Office 文档。** LibreOffice 给文件系统增加 459 MB，给报告出的镜像大小增加 662 MB，而每个租户的 supervisor 共用同一个镜像。独立的转换容器能让应用镜像保持原样，代价是第二个服务、它自己的生命周期，以及两者之间的传输。本次改动选择在镜像内转换，是因为这是让文档留在部署内的最小改动；镜像预算硬性的部署应当选旁挂容器（已测的替代：`-nogui` 模块变体增加 431 MB，只装 `libreoffice-writer-nogui` 增加 368 MB）。

## 后果

- 转换路径现在是三个转换器，前面加一道分类：文档给 `anydoc`，图片与扫描页给 Tesseract，扫描版 Office 文件给 LibreOffice 加 Tesseract。渲染出错不会破坏邮件读取；它会带着原因降级为 `timeout`、`ocr-failed` 或 `empty`，原因出现在工具结果里。
- 端正每页花 0.2 到 0.6 秒，没有 `python3` 时整步跳过；第二个引擎只为需要的页面花约 14 秒。每页都要升级的十页文档不再装得进纯 Tesseract 那时的 90 秒，因此文档上限是 180 秒。两个额外步骤共用这个预算：到期的页面保留第一次读数，而不是让附件失败。
- 第二个引擎是唯一需要 ONNX 模型的部分，运行时可选：没有 `/opt/ocr/py` 的部署仍用 Tesseract 读每一页，返回与先前路径相同的文本。
- 镜像为 OCR 增大 ~115 MB，为 LibreOffice 再增大 ~460 MB，构建需要 `apt-get` 可达。装不上 Tesseract 或 LibreOffice 的部署报告 `converter-missing` 并继续工作。
- 本地 OCR 读 PDF、位图与 Office 文档。Office 文件先被渲染，页面按渲染器的画法到达：Tesseract 返回文本而不是版式，因此表格以行到达。
- 图片没有 hosted 路径。local 用 Tesseract 在本机读取，其他模式报告 ocr-disabled。hosted 仍通过 anydoc 覆盖扫描版 PDF，但那需要本部署没有的 Firecrawl 密钥，因此没有任何图片离开本机。

## 测试

`packages/faberloom/inbound/tests/ocr.spec.ts` 覆盖解析出的二进制（两者、都没有、只有图片、以及运行助手的 Python）、`readTesseract` 重建行与段落并给出置信度中位数且忽略层级行、按写出的文件读一张图片及其 argv、空字节、缺少二进制、非零退出、启动失败、页面超时、Tesseract 不信的页面由第二个引擎重读、第二个引擎缺席时弱页保持原样、按端正后的副本读取页面、端正失败时按原样读取页面、逐页渲染与页码标记、页数上限及其未读提示、受保护的 PDF、所有页面都失败的文档、缺少渲染器、文本截断，以及只为弱页做的一次共享第二次读数。`documents.spec.ts` 覆盖分类（`imageMediaType`、`resolveOcrMode`）、本地 OCR 读取图片、OCR 关闭或 hosted 时的图片、缺少 Tesseract、空的 OCR 结果、失败的 OCR 进程、按媒体类型识别的图片、`needsOcr` 的 PDF 回退、干净但为空的 PDF 回退、转换器读得到的 PDF（OCR 从不启动）、不在 Office 列表里的格式不做 OCR、Office 文件回退到 LibreOffice 且本地 OCR 关闭时保留转换器原因、缺少 LibreOffice、转换失败、旧式 `.xls`、OCR 页面超时、没有字节的附件，以及既有的转换器路径。`office.spec.ts` 覆盖 `resolveOfficeBin` 的两种解析结果、写出的扩展名、转换器 argv、页码标记、成功与失败时删除临时目录、缺少转换器、缺少 OCR 二进制、空字节、转换器写出别的 PDF 文件名、转换没有写出 PDF、零字节 PDF、超过大小上限的 PDF、转换超时、在 OCR 阶段用完整个尝试的时限，以及扩展名不可用的文件名。

按实际 apt 行构建的容器上的真实证据（`node:22.23.2-bookworm-slim` + 三个 LibreOffice 模块 + `fonts-liberation` + Tesseract 与 poppler）：造了一份只含 1241×1754 扫描图的 `.docx`，图上是 "PEDIDO 20845 / SKU 515007019 / 10 337,70 / Total USD 3.377,00"（LibreOffice 从这份 docx 只提取到 1 字节文本），`ocrOffice` 对该文件通过真实的 `libreoffice`、`pdftoppm` 与 `tesseract` 在 1.85 秒内返回 `--- página 1 ---` 加 SKU、数量与总额。最初从该样本记录到过 `515007015` 这一读数；那是被二次栅格化的样本，不是文档本身。在真实采购单上，Tesseract 在 150、200、300 与 400 dpi 下都读对了两个料号与总额。

驱动第二个引擎的四份文档取自所有者邮箱（一张 1200 万像素的手写发票手机照片，加三张热敏小票，每张再左右各旋转 7 度，共十二个变体）：单独的 Tesseract 在照片上对上 5 个校验字段中的 3 个，在旋转小票上对上 0 到 2 个；`deskew` 之后小票回到 5 之 5 并保留词间空格；RapidOCR 在十二个变体上全部 5 之 5。照片的词置信度中位数是 52，而印刷页在 90 到 96 之间，75 的阈值就来自这里。部署容器里测得：端正每页 0.2 到 0.6 秒（写成全分辨率 PNG 时是 8.4 秒，所以助手改写质量 95 的 JPEG），Tesseract 1.8 到 4.7 秒，RapidOCR 每张图 9 到 17 秒，每批再加一次模型加载。

部署容器上的真实证据：OC 20845 的 PDF 带文本层（`pdftotext` 返回 1463 字节），`anydoc` 能转换它（退出 0，1592 字节 Markdown），因此工具路径返回转换器的文本，OCR 不会被调用；以租户 uid 对同一文件跑 `ocrPdf` 约 4 秒内返回订单行（SKU、数量、单价），`image005.jpg`（一张名片照片）返回姓名、电话与邮箱。
