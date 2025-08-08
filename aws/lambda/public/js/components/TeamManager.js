/**
 * チーム管理を担当するクラス
 */
class TeamManager {
    constructor(apiService, notificationManager) {
        this.apiService = apiService;
        this.notificationManager = notificationManager;
        this.teams = {};
        this.teamDropdown = null;
        this.initDropdown();
    }

    /**
     * ドロップダウンを初期化
     */
    initDropdown() {
        this.teamDropdown = new MultiSelectDropdown('teamDropdown', {
            placeholder: 'Select teams (All teams if none selected)',
            searchPlaceholder: 'Search teams...',
            selectAllText: 'Select All',
            deselectAllText: 'Clear Selection',
            noResultsText: 'No teams found',
            selectedText: 'teams selected'
        });
    }

    /**
     * チーム情報を読み込み
     */
    async loadTeams() {
        try {
            const data = await this.apiService.getTeams();
            this.teams = data.teams;
            this.updateDropdownItems();
            return this.teams;
        } catch (error) {
            console.error("Error loading teams:", error);
            this.notificationManager.showError("チーム情報の読み込みに失敗しました");
        }
    }

    /**
     * ドロップダウンのアイテムを更新
     */
    updateDropdownItems() {
        const items = [];
        
        // チームをアイテムに変換
        for (const [teamName, members] of Object.entries(this.teams)) {
            items.push({
                value: teamName,
                label: `${teamName} (${members.length} members)`,
                group: 'Teams'
            });
        }
        
        if (this.teamDropdown) {
            this.teamDropdown.setItems(items);
        }
    }

    /**
     * チーム情報を更新
     */
    async updateTeamInfo() {
        this.notificationManager.showLoading("チーム情報を更新中...");

        try {
            const data = await this.apiService.updateTeams();
            
            if (data.error) {
                throw new Error(data.error);
            }

            // チーム情報を再読み込み
            await this.loadTeams();
            
            this.notificationManager.showSuccess("チーム情報が正常に更新されました");
        } catch (error) {
            console.error("Error:", error);
            this.notificationManager.showError("チーム情報の更新に失敗しました");
        } finally {
            this.notificationManager.hideLoading();
        }
    }

    /**
     * 選択されたチームを取得
     * @returns {Array<string>} 選択されたチーム名の配列
     */
    getSelectedTeams() {
        if (!this.teamDropdown) {
            return [];
        }
        return this.teamDropdown.getSelected();
    }

    /**
     * 選択されたチームを設定
     * @param {Array<string>} teams - 設定するチーム名の配列
     */
    setSelectedTeams(teams) {
        if (this.teamDropdown) {
            this.teamDropdown.setSelected(teams);
        }
    }

    /**
     * 選択されたチームとユーザーを取得
     * @param {UserManager} userManager - ユーザーマネージャー
     * @returns {Object} 選択されたチームとユーザー
     */
    getSelectedTeamsAndUsers(userManager) {
        // 選択されたチーム を取得（何も選択されていない場合は全チーム扱い）
        const selectedTeams = this.getSelectedTeams();

        // 選択されたユーザーを取得
        const users = userManager ? userManager.getSelectedUsers() : [];

        return { teams: selectedTeams, users };
    }

    /**
     * ドロップダウンにイベントリスナーを追加
     * @param {Function} callback - 選択が変更されたときのコールバック
     */
    onSelectionChange(callback) {
        if (this.teamDropdown) {
            const container = document.getElementById('teamDropdown');
            container.addEventListener('change', callback);
        }
    }

    /**
     * ドロップダウンを無効化
     */
    disable() {
        if (this.teamDropdown) {
            this.teamDropdown.disable();
        }
    }

    /**
     * ドロップダウンを有効化
     */
    enable() {
        if (this.teamDropdown) {
            this.teamDropdown.enable();
        }
    }
}