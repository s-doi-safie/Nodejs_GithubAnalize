/**
 * GitHub API との通信を担当するサービスクラス
 */
class GitHubApiService {
    /**
     * 指定した期間のGitHubデータを取得
     * @param {string} fromDate - 開始日 (YYYY-MM-DD)
     * @param {string} toDate - 終了日 (YYYY-MM-DD)
     * @param {Array<string>} teams - チーム名の配列
     * @param {Array<string>} users - ユーザー名の配列
     * @returns {Promise<Object>} GitHub データ
     */
    async fetchData(fromDate, toDate, teams = [], users = []) {
        const response = await fetch('/run-python', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fromDate, toDate, teams, users })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * レビューデータを取得
     * @returns {Promise<Object>} レビューデータ
     */
    async getReviewData() {
        const response = await fetch('/api/review-data', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * チーム情報を取得
     * @returns {Promise<Object>} チーム情報
     */
    async getTeams() {
        const response = await fetch('/api/teams', {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * チーム情報を更新
     * @returns {Promise<Object>} 更新結果
     */
    async updateTeams() {
        const response = await fetch('/update-teams', {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }
}
