# 代理笔记：邮件资源守卫有唯一归属，绘制的图片也使用它

状态：已实现

[English](2026-11-23-mail-resource-guard-single-home.md) | 中文

## 问题

`faberloom_mail_download` 已经正确守护发件人控制的链接，但 `emailImage`——即抓取邮件正文引用的远程图片、让沙箱阅读器从 `data:` URL 绘制的调用——只检查了字面主机名：`127.0.0.1`、`192.168.*`、`.internal`。一个解析到回环地址的公开域名，或落在那里的一次重定向，仍然能到达部署自身的网络，因为 `fetch` 自行解析并连接，并在内部跟随重定向。这正是下载端已经关闭的同一类服务端请求伪造，却在阅读器每打开一封邮件都会调用的界面上仍然敞开。

两种实现也不能简单地互相导入：`tool-faberloom` 为服务类型依赖 `view`，因此 `view` 导入 `tool-faberloom` 会形成包循环。

## 决定

### 一个守卫，归面向邮件的层所有

`packages/faberloom/inbound/src/net-guard.ts` 拥有地址解析、被阻止的网段、固定连接、重定向循环以及字节与时间预算。`inbound` 是两个消费者都已依赖的最低面向邮件层，因此是唯一不产生循环的归属。`fetchPublicResource` 从包根导出，因为工作区构建只产出每个包的 `index`、`invariant`、`startup`：`src/*` 导入在测试中可行，而从未 `lib/` 运行时会失败。

### 消费者保留自己的限制和措辞

`downloadMailLink` 传入 20 MB、30 秒和名词 `link`；`fetchEmailImage` 传入 4 MB、8 秒、`image/*` 和名词 `image`。守卫从不发明限制，拒绝消息保留消费者的词汇（`the link answered more than …`、`the image points at a private address`）。

### 整条链共享一个截止时间与一个预算

第一版每一跳都设置一个超时，因此五次重定向可能耗时五倍。守卫现在只设置一次 `AbortSignal.timeout` 并传给每一跳，一个 `readLimited` 边界覆盖最终应答的正文。

## 考虑过的替代方案

**在 `view` 中复制守卫。** 拒绝：安全表的两个副本会漂移，跨文件克隆检查也会拒绝。

**为守卫新建一个包。** 本切片拒绝：一个包需要自己的清单、tsconfig、聚合注册、锁文件条目和 README，而只有一个模块、两个已经共享低层的消费者。

**依赖 `fetch` 的实现。** 拒绝：阻断性质是地址固定。任何再次解析的客户端都可能在检查之后被重绑定。

## 后果

`emailImage` 在任何连接之前就拒绝答案集包含私有地址的域名，以及指向那里的重定向。同时发布私有答案的合法图片主机也会被拒绝，这是保守方向。下载的公开接口不变：`download.ts` 继续再导出其测试导入的原语。

## 测试

`vitest run packages/faberloom/view/tests/email-image.spec.ts packages/faberloom/tool-faberloom/tests/mail-download.spec.ts` 通过 23 个测试。新增覆盖：解析到 `127.0.0.1` 的域名在未打开任何请求时被拒绝；私有字面地址被拒绝；指向私有地址的重定向被拒绝；指向公开地址的重定向在第二次解析后被跟随；空正文、非图片类型、超大的 `content-length` 和非 http 方案被拒绝；下载套件保持不变并通过。
