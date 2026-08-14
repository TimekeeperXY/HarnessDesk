import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function replaceOnce(source, search, replacement, label) {
  const at = source.indexOf(search)
  if (at === -1) throw new Error(`Harness compatibility patch did not find ${label}`)
  if (source.indexOf(search, at + search.length) !== -1) throw new Error(`Harness compatibility patch found multiple ${label} matches`)
  return source.slice(0, at) + replacement + source.slice(at + search.length)
}

export async function patchHarnessRuntime(runtimeApp) {
  const dshPackage = JSON.parse(await readFile(join(runtimeApp, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  if (dshPackage.version !== '0.1.0-rc.6') throw new Error(`Unsupported Harness patch target ${String(dshPackage.version)}`)

  const hostPath = join(runtimeApp, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  let host = await readFile(hostPath, 'utf8')
  host = replaceOnce(
    host,
    'import { ReasoningEffortId, contentHasImage, createUserMessage, errorChain, freezeMessage } from "@deepseek-ai/dsh-llm";',
    'import { ReasoningEffortId, contentHasImage, createUserMessage, errorChain, freezeMessage } from "@deepseek-ai/dsh-llm";\nimport { encodeVisualAttachmentContext, transformUnsupportedImagePrompt } from "@harnessdesk/dsh-desktop-vision";',
    'host import anchor',
  )
  host = replaceOnce(
    host,
    '\t\t\t\tconst hasImage = content.some((part) => part.type === "image");\n\t\t\t\tconst admit = async () => {',
    '\t\t\t\tconst hasImage = content.some((part) => part.type === "image");\n\t\t\t\tlet admittedContent = content;\n\t\t\t\tconst admit = async () => {',
    'prompt content anchor',
  )
  const rejection = `\t\t\t\t\t\t\tif (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {
\t\t\t\t\t\t\t\tcode: "attachment-error",
\t\t\t\t\t\t\t\tmessage: \`Model "\${current.model}" does not support image input.\`,
\t\t\t\t\t\t\t\tdetails: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
\t\t\t\t\t\t\t});`
  const bridged = `\t\t\t\t\t\t\tif (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) {
\t\t\t\t\t\t\t\tif (process.env.HARNESSDESK_VISION_BRIDGE_ENABLED !== "1") return err(request, {
\t\t\t\t\t\t\t\t\tcode: "attachment-error",
\t\t\t\t\t\t\t\t\tmessage: \`Model "\${current.model}" does not support image input.\`,
\t\t\t\t\t\t\t\t\tdetails: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t\ttry {
\t\t\t\t\t\t\t\t\tconst transformedVisualContent = await transformUnsupportedImagePrompt(content, {
\t\t\t\t\t\t\t\t\t\tenabled: true,
\t\t\t\t\t\t\t\t\t\tendpoint: process.env.HARNESSDESK_VISION_ENDPOINT ?? "http://127.0.0.1:1234/v1",
\t\t\t\t\t\t\t\t\t\tmodel: process.env.HARNESSDESK_VISION_MODEL ?? ""
\t\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t\t\tconst durableVisualContent = await durablePromptContent(ctx, content);
\t\t\t\t\t\t\t\t\tconst visualAttachments = durableVisualContent.flatMap((part) => part.type === "image" ? [part.attachment] : []);
\t\t\t\t\t\t\t\t\tadmittedContent = [...transformedVisualContent, encodeVisualAttachmentContext(visualAttachments)];
\t\t\t\t\t\t\t\t} catch (error) {
\t\t\t\t\t\t\t\t\tconst reason = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "VISION_BRIDGE_MODEL_FAILED";
\t\t\t\t\t\t\t\t\treturn err(request, {
\t\t\t\t\t\t\t\t\t\tcode: "attachment-error",
\t\t\t\t\t\t\t\t\t\tmessage: error instanceof Error ? error.message : "LM Studio vision bridge failed.",
\t\t\t\t\t\t\t\t\t\tdetails: { reason }
\t\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}`
  host = replaceOnce(host, rejection, bridged, 'image capability rejection')
  host = replaceOnce(host, 'content: await durablePromptContent(ctx, content),', 'content: await durablePromptContent(ctx, admittedContent),', 'durable prompt content')
  host = replaceOnce(
    host,
    `function referencedImage(events, attachmentId) {
\tfor (const event of events) {
\t\tconst found = imageInEvent(event, (ref) => String(ref.attachmentId) === attachmentId);
\t\tif (found !== void 0) return found;
\t}
}`,
    `function harnessDeskVisualReferenceIn(content, match) {
\tif (!Array.isArray(content)) return void 0;
\tconst marker = /<harnessdesk_visual_attachments encoding="uri-json">([^<]+)<\\/harnessdesk_visual_attachments>/g;
\tfor (const block of content) {
\t\tif (typeof block !== "object" || block === null || Array.isArray(block) || block.type !== "text" || typeof block.text !== "string") continue;
\t\tfor (const found of block.text.matchAll(marker)) {
\t\t\ttry {
\t\t\t\tconst references = JSON.parse(decodeURIComponent(found[1] ?? ""));
\t\t\t\tif (!Array.isArray(references)) continue;
\t\t\t\tfor (const ref of references) if (typeof ref === "object" && ref !== null && match(ref)) return ref;
\t\t\t} catch {}
\t\t}
\t}
}
function harnessDeskVisualReferenceInEvent(event, match) {
\tconst data = event.data;
\tconst direct = harnessDeskVisualReferenceIn(data.content, match);
\tif (direct !== void 0) return direct;
\tif (data.message !== void 0) {
\t\tconst wrapped = harnessDeskVisualReferenceIn(data.message.content, match);
\t\tif (wrapped !== void 0) return wrapped;
\t}
\tif (data.inserted !== void 0) for (const message of data.inserted) {
\t\tconst inserted = harnessDeskVisualReferenceIn(message.content, match);
\t\tif (inserted !== void 0) return inserted;
\t}
}
function referencedImage(events, attachmentId) {
\tfor (const event of events) {
\t\tconst match = (ref) => String(ref.attachmentId) === attachmentId;
\t\tconst found = imageInEvent(event, match) ?? harnessDeskVisualReferenceInEvent(event, match);
\t\tif (found !== void 0) return found;
\t}
}`,
    'visual attachment authorization',
  )
  await writeFile(hostPath, host)

  const clientPath = join(runtimeApp, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
  let client = await readFile(clientPath, 'utf8')
  client = replaceOnce(
    client,
    `\t\tfunction contentParts(content) {
\t\t\tconst texts = [];
\t\t\tconst images = [];
\t\t\tconst rest = [];
\t\t\tfor (const block of content) {
\t\t\t\tconst b = block;
\t\t\t\tif (b.type === "text" && typeof b.text === "string") texts.push(b.text);
\t\t\t\telse if (b.type === "image" && b.attachment !== void 0) images.push({ attachment: b.attachment });
\t\t\t\telse rest.push(block);
\t\t\t}
\t\t\treturn {
\t\t\t\ttext: texts.join(""),
\t\t\t\timages,
\t\t\t\trest
\t\t\t};
\t\t}`,
    `\t\tfunction harnessDeskVisualProjection(text) {
\t\t\tconst images = [];
\t\t\tconst attachmentMarker = /<harnessdesk_visual_attachments encoding="uri-json">([^<]+)<\\/harnessdesk_visual_attachments>/g;
\t\t\ttext = text.replace(attachmentMarker, (_whole, encoded) => {
\t\t\t\ttry {
\t\t\t\t\tconst references = JSON.parse(decodeURIComponent(encoded));
\t\t\t\t\tif (Array.isArray(references)) for (const attachment of references) {
\t\t\t\t\t\tif (typeof attachment === "object" && attachment !== null && typeof attachment.attachmentId === "string") images.push({ attachment });
\t\t\t\t\t}
\t\t\t\t} catch {}
\t\t\t\treturn "";
\t\t\t});
\t\t\ttext = text.replace(/<harnessdesk_visual_context\\b[^>]*>[\\s\\S]*?<\\/harnessdesk_visual_context>/g, "");
\t\t\treturn { text: text.trim(), images };
\t\t}
\t\tfunction contentParts(content) {
\t\t\tconst texts = [];
\t\t\tconst images = [];
\t\t\tconst rest = [];
\t\t\tfor (const block of content) {
\t\t\t\tconst b = block;
\t\t\t\tif (b.type === "text" && typeof b.text === "string") texts.push(b.text);
\t\t\t\telse if (b.type === "image" && b.attachment !== void 0) images.push({ attachment: b.attachment });
\t\t\t\telse rest.push(block);
\t\t\t}
\t\t\tconst visual = harnessDeskVisualProjection(texts.join(""));
\t\t\treturn {
\t\t\t\ttext: visual.text,
\t\t\t\timages: [...images, ...visual.images],
\t\t\t\trest
\t\t\t};
\t\t}`,
    'user message visual projection',
  )
  client = replaceOnce(
    client,
    '\t\t\t\tcase "MODEL_DOES_NOT_SUPPORT_IMAGES": return t("image.modelUnsupported");',
    '\t\t\t\tcase "MODEL_DOES_NOT_SUPPORT_IMAGES": return t("image.modelUnsupported");\n\t\t\t\tcase "VISION_BRIDGE_UNAVAILABLE": return t("image.visionBridgeUnavailable");\n\t\t\t\tcase "VISION_BRIDGE_NO_MODEL": return t("image.visionBridgeNoModel");\n\t\t\t\tcase "VISION_BRIDGE_CONFIG_INVALID": return t("image.visionBridgeConfigInvalid");\n\t\t\t\tcase "VISION_BRIDGE_MODEL_FAILED":\n\t\t\t\tcase "VISION_BRIDGE_INVALID_RESPONSE": return t("image.visionBridgeFailed");',
    'attachment error labels',
  )
  client = replaceOnce(
    client,
    '\t\t\t"image.modelUnsupported": "当前模型不支持图片，请切换支持图片的模型",',
    '\t\t\t"image.modelUnsupported": "当前模型不支持图片，请切换支持图片的模型",\n\t\t\t"image.visionBridgeUnavailable": "无法连接本机 LM Studio，请启动服务器后重试",\n\t\t\t"image.visionBridgeNoModel": "LM Studio 没有可用的视觉模型，请先加载模型",\n\t\t\t"image.visionBridgeConfigInvalid": "LM Studio 视觉桥设置无效，请在 HarnessDesk 设置中检查",\n\t\t\t"image.visionBridgeFailed": "LM Studio 视觉模型读取图片失败，请检查模型和服务器日志",',
    'Chinese vision labels',
  )
  client = replaceOnce(
    client,
    '\t\t\t"image.modelUnsupported": "The current model does not support images; switch to a model that does",',
    '\t\t\t"image.modelUnsupported": "The current model does not support images; switch to a model that does",\n\t\t\t"image.visionBridgeUnavailable": "Cannot reach local LM Studio; start its server and try again",\n\t\t\t"image.visionBridgeNoModel": "LM Studio has no available vision model; load one first",\n\t\t\t"image.visionBridgeConfigInvalid": "LM Studio vision bridge settings are invalid; check HarnessDesk settings",\n\t\t\t"image.visionBridgeFailed": "The LM Studio vision model could not read the image; check the model and server logs",',
    'English vision labels',
  )
  await writeFile(clientPath, client)
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const runtimeApp = process.argv[2]
  if (!runtimeApp) throw new Error('Usage: node patch-harness-runtime.mjs <runtime-app>')
  await patchHarnessRuntime(runtimeApp)
  console.log('Applied HarnessDesk vision bridge compatibility patch')
}
