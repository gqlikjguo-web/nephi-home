# SaaS LINE 回覆安全修正實作計畫

1. 新增服務層聚焦測試並確認三項問題會失敗。
2. 加入受限公開房型名稱 formatter，套用於房況與房型容量回覆。
3. 加入 property 資料證據式設備匹配，未知設備走既有 handoff／review。
4. 加入四類結構化價格 formatter，保留日期覆寫資料流程。
5. 執行聚焦測試、完整 `npm test`、敏感資訊掃描及 `git diff --check`。
6. commit、push，等待 Render deploy 後驗證 health 200／ready。
