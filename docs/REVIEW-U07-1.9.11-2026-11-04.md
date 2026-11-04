# U07工具图片及文件投影缺口 · 1.9.11候选修复记录

日期：2026-11-04。原版本1.9.10。用户给出的工具图片丢失反馈经复现成立，之前U07只覆盖用户图片和真实用户上传图片，未覆盖工具结果路径，应当补记为未完成验收项。

## 逐项核对

1. OpenCode的role=tool确实只调用textOf，丢掉图片。现改为Pi ToolResultMessage支持的TextContent/ImageContent序列，保持toolCallId、toolName、isError；用户和工具图片均由相同内容投影处理。
2. CommandCode的OpenAI及CLI工具分支确实丢图。工具结果本身不支持OpenAI image_url数组，不能直接把user content数组塞进tool。现参考本地Pi SDK：连续工具结果先完整输出并保留所有tool_call_id，再追加带来源标记的user图片消息。Anthropic工具结果则在tool_result.content内发送合法图片块。
3. OpenDesign虽没有显式tool条件，却由循环末尾通用分支当作工具结果处理，同样只取文本。已按OpenAI规则修复，并回归多个工具结果保持紧邻。
4. 工具图片先读字节再丢弃的问题随协议修复关闭。三家的字节收集使用共享wantedImagesOf；只读取需要的图片，去重且跳过offloaded。已知不支持的图片角色会在读取前明确报UNSUPPORTED_CONTENT，协议直调也有同样保护。
5. 原始file块在协议直调时确实被跳过；但本地宿主LlmRuntime正常请求路径先执行projectFilesToText，将文件转换为带只读路径的文本。因此不能从直接buildRequestBody探针推断普通PDF上传全部丢失。

## 文件处理的确切语义

正常宿主已经转好的文件文本继续原样保留。协议若收到未经宿主投影的原始file，使用宿主fileHandleText保留文件名、字节数和身份；协议层没有附件执行路径解析器时明确说明“当前环境无法访问可读路径，不要声称已经读取”。不拼造路径、不把文件误当成PDF正文、不谎称完成PDF解析。缺少合法id/name/bytes的引用明确拒绝。

user/tool/assistant文件及system/developer原始文件均有明确句柄投影；不支持的assistant/system/developer图片明确拒绝，不再静默过滤。工具图片取不到字节或已卸载时保留对应占位，不用空请求伪装成功。

## 验证

- CommandCode新增完整请求矩阵57例，加原49例共106例通过，覆盖openai/messages/cli。
- OpenCode真实Pi SDK三种协议出站捕获通过，验证Anthropic tool_result内图片、Completions补充user image_url、Responses工具输出input_image及调用关联/错误状态。
- OpenDesign新增10例工具附件回归；三家均验证连续工具、纯图/混图/多图及缺失/卸载情况。
- 共享层10例验证文件句柄、无效引用、图像角色拒绝、去重与卸载不读字节。
- 另补3例完整OpenCode adapter.stream→附件读取→真实SDK→假HTTP出站，验证工具图片字节实际进入请求，缺失/卸载不读字节且保留占位。
- 完整181个测试文件1867例通过，类型检查、构建、补丁格式检查通过。

本轮是离线假传输与真实SDK的请求捕获验证，没有向真实模型发送工具截图，也未进行实际PDF内容阅读验收。新增88例覆盖这次缺口，不以测试总数推断全部功能无Bug。

## 交付

版本标记为1.9.11候选修复版，保持此前撤回最终定版的判断。源码、构建产物、修复记录与回归随提交推送；本机安装副本备份后更新，运行中的DSH须重载后使用新代码，不中断用户其他会话。
