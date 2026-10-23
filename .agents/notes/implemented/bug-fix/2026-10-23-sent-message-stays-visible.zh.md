# Agent Note: A sent message stays visible until its durable row arrives

Status: implemented

[English](2026-10-23-sent-message-stays-visible.md) | 中文

## 问题

在 web 与桌面聊天中，发往全新或空闲会话的消息在等待首个 token 期间会从记录里消失。它只在回合开始记录后才重新出现——先是上下文注入行，然后才是持久的用户气泡。模型仍在工作时，读者只看到回合状态（“Explorando a fondo…”）和一片空白会话，无法判断消息是否已发送。

Chat 视图会渲染本地提交回声，直到其持久对应项到达，并在 `observedRpcIds` 报告该请求 id 已被观察时隐藏它。该集合包含所有队列出现项，而不只是持久用户节点。Host 一旦把已接受的提示列为队列出现项——此时回合尚未写入 `user/message` 事件——回声就被过滤掉，留下既无回声也无持久行的窗口。

## 决策

**只有持久证据才让记录回声退休。** `observedRpcIds` 只会从持久 `user` 或 `steering` 节点，或从 placement 为 `steering` 的队列出现项收集请求 id。单独的队列出现项不再隐藏回声：气泡停在读者发送它的位置，直到回合开始并由其 `user/message` 节点替换。

**Steering 保留即时交接。** steering 出现项已经在待定 steering 行里携带相同内容，因此它和以前一样让本地回声退休；否则两者会并排渲染。

## 考虑过的替代方案

**同时把队列回声渲染到记录里。** 否决：Queue dock 已经拥有队列出现项，两者都渲染会让同一条已发送消息出现两次。

**修改 Host，让队列投影延迟到持久事件之后。** 否决：队列投影本身是合法的，并驱动队列 dock；是渲染器从中得出了错误结论。

**只调整跟随滚动。** 否决：首次复现时状态下方是空记录，而不是一个滚出视野的气泡。滚动无法创建已被过滤器移除的行。

## 后果

已发送消息从点击起一直可见，直到持久气泡无间隙、无重复地接管。运行回合之后的排队消息仍只存在于 Queue dock；它的记录回声从未放置在那里。

## 测试

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` 覆盖请求 id 只出现在队列出现项中的记录回声：回声保持可见，持久用户节点到达后恰好只剩一个气泡。既有 steering 交接与队列回声用例保持通过。
