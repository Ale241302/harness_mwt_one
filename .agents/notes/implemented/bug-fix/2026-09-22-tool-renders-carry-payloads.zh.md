# Agent Note: 数据工具的 render 必须携带数据本体，而非摘要

Status: implemented

[English](2026-09-22-tool-renders-carry-payloads.md) | 中文

## 问题

`faberloom_mail_search` 本来是好用的——它真实登录了所有者的 IMAP 并返回了真实信封——但它的 `output.render` 只产出 `Mailbox matches: N`。render 是模型实际读到的文本，于是助手断定该工具是个只会回显 limit 的桩，反复换查询重试，最终放弃用户配置的邮箱，转而从 MWT 控制台的 correo 模块回答。同样的"藏数据"模式还存在于 `faberloom_mwt_call`（"answered."）、`faberloom_mwt_find`（"Data found in: X."）和 `faberloom_board_list`（"Board items: N."）。

## 决策

每个返回数据的工具，其 render 都携带数据本体，并做有界截断：

- `faberloom_mail_search` 每个信封渲染一行（`date · from · subject`），为空时渲染"Sin coincidencias en el buzón."。
- `faberloom_mwt_call` 通过 `renderJson(value, max)` 把结果 JSON 截断到 4.000 字符，并标注省略的字符数。
- `faberloom_mwt_find` 渲染命中的租户，外加每家公司一行 `company: data|sin datos`，每个数据体截断到 1.500 字符。
- `faberloom_board_list` 每条渲染 `id · status · title`。

截断只发生在 render；会话日志和 UI 卡片读取的结构化值不变。

## 已考虑的替代方案

- **更大的上限或不截断。** 否决：render 会占用模型上下文；一个 2412 封邮件的邮箱或大型 MWT 数据体总要在某处截断，而截断点就应在展示边界，并带显式的省略标记。
- **每个数据工具再配一个"详情"工具。** 否决：模型不应需要二次调用才能看到工具刚返回的内容；render 才是正确通道。

## 后果

- 像"revísame los correos de tal cosa"这样的聊天查询，现在能让助手看到真实信封，从而基于用户配置的 IMAP/SMTP 连接回答，而不是误判工具为假后回退到其他数据源。
- render 的变更是模型可见文本：这些工具还没有被任何已录制会话夹具使用，因此无需更新快照。
- 这个 bug 的教训在此记录，因为它具有普遍性：数据工具只渲染计数是缺陷而非风格选择；新工具必须断言其 render 携带数据本体（见 `tool-faberloom/tests/router.spec.ts`）。
