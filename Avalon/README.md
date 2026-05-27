# 阿瓦隆 Online

一个浏览器版联网阿瓦隆。服务端保存房间状态，玩家通过同一个公网网址和房间邀请链接加入同一局。

## 本地运行

```bash
npm start
```

打开 `http://localhost:3000`。

## 公网对战

本项目已经支持公网部署：HTTP 页面和 WebSocket 房间同步在同一个 Node 服务里，部署到支持 WebSocket 的平台后即可让不同网络的玩家加入。

推荐 Render：

1. 把 `F:\Avalon` 推到 GitHub 仓库。
2. 在 Render 新建 Web Service，选择该仓库。
3. Build Command 填 `npm install --omit=dev`。
4. Start Command 填 `npm start`。
5. Health Check Path 填 `/healthz`。
6. 部署完成后打开 Render 给你的 `https://...onrender.com` 地址。

玩家流程：

1. 第一名玩家打开公网地址，输入昵称，房间号留空创建房间。
2. 在房间页点击“复制邀请链接”。
3. 把链接发给其他玩家。
4. 5-10 人到齐后由房主开始。

也可以用 Docker 部署：

```bash
docker build -t avalon-online .
docker run -p 3000:3000 avalon-online
```

## 规则范围

- 5-10 人标准任务人数。
- 第四次任务在 7 人及以上时需要 2 张失败牌才失败。
- 连续 5 次组队失败，邪恶阵营获胜。
- 正义阵营不能打失败牌。
- 3 次任务成功后进入刺杀梅林阶段。
- 支持梅林、派西维尔、莫甘娜、刺客、莫德雷德、奥伯伦、忠臣、爪牙。
