/**
 * 日付関連のユーティリティクラス
 */
class DateUtils {
    /**
     * 日付をYYYY-MM-DD形式にフォーマット
     * @param {Date} date - 日付オブジェクト
     * @returns {string} フォーマットされた日付文字列
     */
    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    /**
     * 指定日数前の日付を取得
       * @param {number} daysAgo - 何日前か
       * @returns {string} YYYY-MM-DD形式の日付
       */
    getDaysAgo(daysAgo) {
        const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        return date.toISOString().split('T')[0];
    }

    /**
     * 今日の日付を取得
     * @returns {string} YYYY-MM-DD形式の今日の日付
     */
    getToday() {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * 2つの日付間の日数差を計算
     * @param {string} date1 - 日付1 (YYYY-MM-DD)
     * @param {string} date2 - 日付2 (YYYY-MM-DD)
     * @returns {number} 日数差
     */
    dateDiffInDays(date1, date2) {
        const dt1 = new Date(date1);
        const dt2 = new Date(date2);

        // UTC日付に変換（時差の影響を排除）
        const utc1 = Date.UTC(dt1.getFullYear(), dt1.getMonth(), dt1.getDate());
        const utc2 = Date.UTC(dt2.getFullYear(), dt2.getMonth(), dt2.getDate());

        // 日数の差を計算（ミリ秒を日に変換）
        const diffDays = Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24));

        return diffDays;
    }
}
